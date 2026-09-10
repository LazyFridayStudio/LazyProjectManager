import { meQuery, type MeView } from '@lpm/shared';
import { permittedActions, SetupRequiredError } from '../../../domain/index.js';

import { defineQueryHandler } from '../../../cqrs/query-registry.js';
import { fileUrl } from '../../files/index.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import { mayDo } from '../../projects/project-access.js';
import { themeColorsSchema, themeSchema } from '@lpm/shared';

/**
 * Who the caller is.
 *
 * The web client asks this on every load to decide between the app and the login
 * screen, so it is deliberately one round trip covering the user, their
 * memberships and the install's own identity.
 */
export const meQueryHandler = defineQueryHandler({
  definition: meQuery,

  async execute(_params, context): Promise<MeView> {
    const actor = requireActor(context, meQuery.name);

    const [user, memberships, install] = await Promise.all([
      loadUser(context, actor),
      loadMemberships(context, actor),
      loadInstall(context),
    ]);

    return { user, memberships, install, may: mayOnThisInstall(actor, memberships) };
  },
});

/**
 * Every install-wide action this person may do, decided here rather than guessed
 * at by the client.
 *
 * The shell uses it to leave out a tab whose screen would refuse them, and the
 * bin uses it to leave out a button whose command would. Both of those used to
 * be `role === 'owner'`, which was right until permission groups existed and
 * could hand `recovery.restore` to somebody who is not an owner.
 *
 * From the memberships already loaded, so this costs no extra query. A person
 * with no membership in the account their session names may do nothing — which
 * is the same answer every handler gives them a moment later.
 */
function mayOnThisInstall(actor: RequestActor, memberships: MeView['memberships']): string[] {
  const membership = memberships.find((each) => each.accountId === actor.accountId);

  if (membership === undefined) {
    return [];
  }

  return permittedActions.filter((action) => mayDo({ actor, role: membership.role, action }));
}

async function loadUser(context: RequestContext, actor: RequestActor): Promise<MeView['user']> {
  const user = await context.database
    .selectFrom('appUser')
    .leftJoin('file as avatar', 'avatar.id', 'appUser.avatarFileId')
    .select([
      'appUser.id as id',
      'appUser.email as email',
      'appUser.displayName as displayName',
      'appUser.initials as initials',
      'appUser.avatarFileId as avatarFileId',
      'avatar.state as avatarState',
      'appUser.theme as theme',
      'appUser.themeColors as themeColors',
    ])
    .where('appUser.id', '=', actor.userId)
    .executeTakeFirstOrThrow();

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    initials: user.initials,
    /*
     * Parsed rather than trusted, and dark when it will not parse.
     *
     * The column is text with a check constraint, so a row can only hold a
     * theme this build knows about — unless the build is older than the row,
     * which is a downgrade. A theme nobody can render is better read as the
     * default than as a screen that does not draw.
     */
    theme: themeSchema.catch('dark').parse(user.theme),
    /*
     * Parsed on the way out for the same reason the theme is.
     *
     * A row written by a newer build, or edited by hand, is read as no theme at
     * all rather than as a palette half of which is missing — the client falls
     * back to dark, which is a screen somebody can use to fix it.
     */
    themeColors: themeColorsSchema.nullable().catch(null).parse(user.themeColors),
    // Null until the bytes have arrived, so a picture chosen a second ago is
    // still the initials for that second rather than a broken image.
    avatarUrl:
      user.avatarFileId === null || user.avatarState !== 'stored'
        ? null
        : fileUrl(user.avatarFileId),
  };
}

async function loadMemberships(
  context: RequestContext,
  actor: RequestActor,
): Promise<MeView['memberships']> {
  return context.database
    .selectFrom('membership')
    .innerJoin('account', 'account.id', 'membership.accountId')
    .select([
      'membership.accountId as accountId',
      'account.name as accountName',
      'membership.role as role',
    ])
    .where('membership.userId', '=', actor.userId)
    .orderBy('account.name')
    .execute();
}

async function loadInstall(context: RequestContext): Promise<MeView['install']> {
  const install = await context.database
    .selectFrom('installSettings')
    .select(['serverName', 'baseUrl'])
    .executeTakeFirst();

  if (install === undefined) {
    // A signed-in user on an install with no settings row means the database was
    // restored from a partial backup. Saying so beats returning empty strings
    // the UI would render as a blank server name.
    throw new SetupRequiredError();
  }

  return install;
}
