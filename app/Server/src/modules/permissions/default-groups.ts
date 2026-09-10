import { CATALOGUES, catalogues, permittedActions } from '../../domain/index.js';
import type { CommandTransaction } from '../../cqrs/execute-command.js';

/** The group that holds everything, named for what it makes somebody. */
const ADMINISTRATOR = 'Administrator';

/**
 * What a new install starts with.
 *
 * An install used to begin with no groups at all, which meant the first thing
 * anybody did with permissions was build, by hand, the seven obvious ones. They
 * are obvious because the screen already groups every action under seven
 * headings — so these are those headings, plus the one that holds the lot.
 *
 * **Every rule is an allow.** A group of allows can only widen somebody, so a
 * studio that gives one out by mistake has handed over too much rather than
 * locked somebody out of something. Nothing here takes anything away, and there
 * is nothing to undo beyond deleting the group.
 *
 * They are ordinary groups once made. Renaming, editing and deleting them all
 * work, and nothing reads them back — the install does not know or care that it
 * made them.
 */
export function defaultPermissionGroups(): readonly {
  readonly name: string;
  readonly actions: readonly string[];
}[] {
  return [
    { name: ADMINISTRATOR, actions: permittedActions },
    ...catalogues.map((catalogue) => ({
      name: CATALOGUES[catalogue].label,
      actions: CATALOGUES[catalogue].actions,
    })),
  ];
}

/**
 * Writes them, in the transaction that makes the install.
 *
 * All of it or none: an install that got half its groups because a later
 * statement failed is one nobody can tell from a studio that deleted the rest
 * on purpose.
 */
export async function seedDefaultPermissionGroups(
  transaction: CommandTransaction,
  accountId: string,
): Promise<void> {
  for (const group of defaultPermissionGroups()) {
    const made = await transaction.database
      .insertInto('permissionGroup')
      .values({ accountId, name: group.name })
      .returning('id')
      .executeTakeFirstOrThrow();

    await transaction.database
      .insertInto('permissionRule')
      .values(
        group.actions.map((action) => ({
          accountId,
          groupId: made.id,
          // One row per action, never a heading. A heading is a way of setting
          // the actions under it, not a thing that is stored.
          action,
          effect: 'allow',
        })),
      )
      .execute();
  }
}
