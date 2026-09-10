import {
  confirmUploadCommand,
  createCommandSuccess,
  createUploadSuccess,
  detachFileCommand,
  isImageMime,
  notAnImageMessage,
  requestUploadCommand,
  type CommandSuccess,
  type UploadTarget,
} from '@lpm/shared';

import type { DatabaseTransaction } from '@lpm/database';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import {
  AssetNotFoundError,
  CardNotFoundError,
  InvariantViolatedError,
  positionBetween,
  type MembershipRole,
} from '../../../domain/index.js';
import { buildStorageKey } from '../../../storage/index.js';
import { fileUrl } from '../file-url.js';
import { loadWritableCard, loadWritableProject } from '../../board/cards/card-access.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import type { PermittedAction } from '../../../domain/index.js';
import { assertIsAnAgent } from '../../identity/is-an-agent.js';

/**
 * Who is asking, and whether they may.
 *
 * The action is a parameter because putting a file somewhere and taking one
 * away are not the same act — and both used to be `card.update`, which also
 * covered rewriting the design document.
 */
async function authorise(
  context: RequestContext,
  commandName: string,
  action: PermittedAction,
): Promise<{ actor: RequestActor; role: MembershipRole }> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action });

  return { actor, role };
}

/**
 * The same question, for a file that is nobody's business but the sender's.
 *
 * A picture of yourself is not a file put *on* something, so `file.upload` is
 * the wrong question to ask about it — that action's floor is `member`, and a
 * viewer choosing their own face is not somebody a permission should be
 * refusing. It is the reasoning `identity.me` and `identity.updateProfile`
 * already run on.
 *
 * Everything else still answers to `file.upload`, and the branch is on the kind
 * of target rather than on anything the caller says about themselves.
 */
async function authoriseUpload(
  context: RequestContext,
  commandName: string,
  target: UploadTarget,
): Promise<{ actor: RequestActor; role: MembershipRole }> {
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  if (target.kind === 'agentAvatar') {
    // Somebody else's picture, which is only allowed because the somebody is an
    // agent and cannot choose one itself. Changing an agent, so `agent.update`.
    assertProjectPermission({ actor, role, action: 'agent.update' });
    await assertIsAnAgent(context.database, actor.accountId, target.userId);
  } else if (target.kind !== 'userAvatar') {
    assertProjectPermission({ actor, role, action: 'file.upload' });
  }

  return { actor, role };
}

/** Whether this file is the picture the person asking chose for themselves. */
async function isTheirOwnPicture(
  database: RequestContext['database'],
  actor: RequestActor,
  fileId: string,
): Promise<boolean> {
  const person = await database
    .selectFrom('appUser')
    .select('avatarFileId')
    .where('id', '=', actor.userId)
    .executeTakeFirst();

  return person?.avatarFileId === fileId;
}

interface RequestUploadInput {
  commandId: string;
  target: UploadTarget;
  filename: string;
  mime: string;
  bytes: number;
}

/**
 * Asks for somewhere to put a file, and says where it will hang once it arrives.
 *
 * The row and the attachment are written now, both pointing at a file that is
 * still pending; the card shows neither until the upload is confirmed. Writing
 * them here is what lets the confirm be nothing but a file id — the browser has
 * enough to keep track of without also carrying which card it was doing this
 * for.
 */
/**
 * Refuses a file that does not belong where it is being sent.
 *
 * Only the reference sheet is fussy, and only because it is a sheet of
 * pictures: a `.blend` there is a tile with a filename on it where a picture
 * should be, and one of them is the asset's thumbnail. Everywhere else takes
 * whatever a studio works in, which is the whole point of the files list.
 *
 * The browser's `accept` is a hint the file dialog honours and a drag ignores,
 * so the rule has to live here as well.
 */
function assertBelongsOnTarget(target: UploadTarget, filename: string, mime: string): void {
  if ((target.kind === 'userAvatar' || target.kind === 'agentAvatar') && !isImageMime(mime)) {
    throw new InvariantViolatedError(notAnImageMessage(filename));
  }

  if (target.kind === 'assetReference' && !isImageMime(mime)) {
    // The same sentence the browser uses when it refuses one before sending it,
    // because one rule saying two different things is one rule too many.
    throw new InvariantViolatedError(notAnImageMessage(filename));
  }
}

/**
 * Whoever the file is about to belong to, and whether this caller may put one
 * there.
 *
 * An asset is checked through its project, so the rule about who can reach what
 * is written once rather than once per kind of thing a file can hang off.
 */
async function loadOwner(
  access: { database: DatabaseTransaction; actor: RequestActor; role: MembershipRole },
  target: UploadTarget,
): Promise<{ accountId: string }> {
  if (target.kind === 'userAvatar' || target.kind === 'agentAvatar') {
    // Nothing to look up. There is no project in the question, and both are
    // about somebody in the asker's own account — which the agent case checked
    // when it authorised.
    return { accountId: access.actor.accountId };
  }

  if (target.kind === 'cardAttachment') {
    return loadWritableCard(access, target.cardId);
  }

  if (target.kind === 'projectKeyArt' || target.kind === 'projectLogo') {
    return loadWritableProject(access, target.projectId);
  }

  const asset = await access.database
    .selectFrom('asset')
    .select('projectId')
    .where('id', '=', target.assetId)
    .where('accountId', '=', access.actor.accountId)
    .executeTakeFirst();

  if (asset === undefined) {
    throw new AssetNotFoundError();
  }

  return loadWritableProject(access, asset.projectId);
}

/**
 * Points the thing at its new file.
 *
 * A card gathers attachments, and an asset gathers reference images and, apart
 * from those, the working files it is made of — so all three add. A project has
 * one piece of key art and one logo, so those replace, and the file replaced is
 * left in the store because something else may still point at it.
 */
interface Attachment {
  readonly database: DatabaseTransaction;
  readonly target: UploadTarget;
  readonly fileId: string;
  readonly filename: string;
  readonly accountId: string;
  /** Whose picture it is, when that is what this file turns out to be. */
  readonly uploadedBy: string;
}

async function attachTo({
  database,
  target,
  fileId,
  filename,
  accountId,
  uploadedBy,
}: Attachment): Promise<void> {
  if (target.kind === 'userAvatar' || target.kind === 'agentAvatar') {
    // Replaces whatever was there, like a project's logo. The file it replaced
    // stays in the store, because something else may still point at it.
    await database
      .updateTable('appUser')
      .set({ avatarFileId: fileId })
      .where('id', '=', target.kind === 'agentAvatar' ? target.userId : uploadedBy)
      .execute();

    return;
  }

  if (target.kind === 'cardAttachment') {
    await database.insertInto('cardAttachment').values({ cardId: target.cardId, fileId }).execute();

    return;
  }

  if (target.kind === 'projectKeyArt') {
    await database
      .updateTable('project')
      .set({ keyArtFileId: fileId })
      .where('id', '=', target.projectId)
      .execute();

    return;
  }

  if (target.kind === 'projectLogo') {
    await database
      .updateTable('project')
      .set({ logoFileId: fileId })
      .where('id', '=', target.projectId)
      .execute();

    return;
  }

  if (target.kind === 'assetFile') {
    await database
      .insertInto('assetFile')
      .values({
        accountId,
        assetId: target.assetId,
        fileId,
        // The filename is what to call it until somebody says otherwise, which
        // is what they called it on their own machine.
        label: filename,
        position: await nextPosition(database, 'assetFile', target.assetId),
      })
      .execute();

    return;
  }

  // Onto the end of the sheet. The first reference is the one a tile shows, so
  // adding a second picture must not quietly change what the asset looks like.
  await database
    .insertInto('assetReference')
    .values({
      accountId,
      assetId: target.assetId,
      fileId,
      position: await nextPosition(database, 'assetReference', target.assetId),
    })
    .execute();
}

/** The end of whichever list this asset keeps, in the order somebody added to it. */
async function nextPosition(
  database: DatabaseTransaction,
  table: 'assetReference' | 'assetFile',
  assetId: string,
): Promise<number> {
  const last = await database
    .selectFrom(table)
    .select('position')
    .where('assetId', '=', assetId)
    .orderBy('position', 'desc')
    .limit(1)
    .executeTakeFirst();

  return positionBetween(last === undefined ? null : Number(last.position), null);
}

export const requestUploadHandler = defineCommandHandler({
  definition: requestUploadCommand,

  async execute(input: RequestUploadInput, context): Promise<CommandSuccess> {
    const { actor, role } = await authoriseUpload(context, requestUploadCommand.name, input.target);

    const outcome = await executeCommand({
      database: context.database,
      commandName: requestUploadCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        assertBelongsOnTarget(input.target, input.filename, input.mime);

        const access = { database: transaction.database, actor, role };
        const owner = await loadOwner(access, input.target);

        const file = await transaction.database
          .insertInto('file')
          .values({
            accountId: owner.accountId,
            // Replaced below: the real key needs the id the database just made.
            storageKey: crypto.randomUUID(),
            filename: input.filename,
            mime: input.mime,
            uploadedBy: actor.userId,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        const storageKey = buildStorageKey(owner.accountId, file.id, input.filename);

        await transaction.database
          .updateTable('file')
          .set({ storageKey })
          .where('id', '=', file.id)
          .execute();

        await attachTo({
          database: transaction.database,
          target: input.target,
          fileId: file.id,
          filename: input.filename,
          accountId: owner.accountId,
          uploadedBy: actor.userId,
        });

        return { fileId: file.id, storageKey, mime: input.mime };
      },
    });

    if (!outcome.applied) {
      return createCommandSuccess();
    }

    // The file's own address, which is where it will be readable from once it
    // has arrived. One place, one permission check, and nothing for an operator
    // to configure: the browser is already talking to this server.
    return createUploadSuccess(outcome.result.fileId, fileUrl(outcome.result.fileId));
  },
});

/**
 * The project a freshly stored file belongs to, whatever it hangs on.
 *
 * Only cards were looked up here, so an upload to an asset published no
 * invalidation at all — the frame carries the project, and without one nothing
 * is sent. Somebody else's tab then kept showing a reference sheet with the
 * picture missing until they reloaded.
 */
async function findOwningProject(
  database: DatabaseTransaction,
  fileId: string,
): Promise<{ projectId: string; cardId: string | null } | undefined> {
  const attached = await database
    .selectFrom('cardAttachment')
    .innerJoin('card', 'card.id', 'cardAttachment.cardId')
    .select(['card.id as cardId', 'card.projectId as projectId'])
    .where('cardAttachment.fileId', '=', fileId)
    .executeTakeFirst();

  if (attached !== undefined) {
    return attached;
  }

  const onAsset = await database
    .selectFrom('assetReference')
    .innerJoin('asset', 'asset.id', 'assetReference.assetId')
    .select('asset.projectId')
    .where('assetReference.fileId', '=', fileId)
    .executeTakeFirst();

  if (onAsset !== undefined) {
    return { projectId: onAsset.projectId, cardId: null };
  }

  const asAssetFile = await database
    .selectFrom('assetFile')
    .innerJoin('asset', 'asset.id', 'assetFile.assetId')
    .select('asset.projectId')
    .where('assetFile.fileId', '=', fileId)
    .executeTakeFirst();

  if (asAssetFile !== undefined) {
    return { projectId: asAssetFile.projectId, cardId: null };
  }

  const onProject = await database
    .selectFrom('project')
    .select('id as projectId')
    .where((builder) =>
      builder.or([builder('keyArtFileId', '=', fileId), builder('logoFileId', '=', fileId)]),
    )
    .executeTakeFirst();

  return onProject === undefined ? undefined : { projectId: onProject.projectId, cardId: null };
}

/**
 * Says the upload finished, and checks that it did.
 *
 * The size and type are read back from the store rather than believed. A file
 * the browser claims to have sent and did not would otherwise sit on a card as
 * something nobody can open, and a size it made up is what a quota would later
 * be built on.
 */
export const confirmUploadHandler = defineCommandHandler({
  definition: confirmUploadCommand,

  async execute(input: { commandId: string; fileId: string }, context): Promise<CommandSuccess> {
    const actor = requireActor(context, confirmUploadCommand.name);

    // The other half of the branch in `authoriseUpload`. A person confirming
    // the picture they were just allowed to send must not be refused here by an
    // action whose floor is `member`; everything else still answers to it.
    if (!(await isTheirOwnPicture(context.database, actor, input.fileId))) {
      await authorise(context, confirmUploadCommand.name, 'file.upload');
    }

    const file = await context.database
      .selectFrom('file')
      .select(['id', 'storageKey'])
      .where('id', '=', input.fileId)
      .where('accountId', '=', actor.accountId)
      .executeTakeFirst();

    if (file === undefined) {
      throw new CardNotFoundError();
    }

    const stored = await context.storage.describe(file.storageKey);

    if (stored === null) {
      throw new InvariantViolatedError('That file never arrived. Try uploading it again.');
    }

    const outcome = await executeCommand({
      database: context.database,
      commandName: confirmUploadCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        await transaction.database
          .updateTable('file')
          .set({
            state: 'stored',
            bytes: stored.bytes,
            mime: stored.mime,
            storedAt: new Date(),
          })
          .where('id', '=', file.id)
          .execute();

        const owner = await findOwningProject(transaction.database, file.id);

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'card',
          aggregateId: owner?.cardId ?? file.id,
          name: 'files.uploaded',
          // No filename: the outbox is read more widely than the card, and what
          // a studio calls a file can say what it is working on.
          payload: { projectId: owner?.projectId ?? null, fileId: file.id, bytes: stored.bytes },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(file.id) : createCommandSuccess();
  },
});

/**
 * Takes a file off a card.
 *
 * The object stays in the store. The same file can be on more than one card, and
 * deleting the bytes because one of them let go would break the others.
 */
export const detachFileHandler = defineCommandHandler({
  definition: detachFileCommand,

  async execute(
    input: { commandId: string; attachmentId: string },
    context,
  ): Promise<CommandSuccess> {
    const { actor, role } = await authorise(context, detachFileCommand.name, 'file.remove');

    const outcome = await executeCommand({
      database: context.database,
      commandName: detachFileCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const attachment = await transaction.database
          .selectFrom('cardAttachment')
          .select(['id', 'cardId', 'fileId'])
          .where('id', '=', input.attachmentId)
          .executeTakeFirst();

        if (attachment === undefined) {
          throw new CardNotFoundError();
        }

        // Reached through its card, so an id from another install is refused the
        // same way the card behind it would be.
        const card = await loadWritableCard(
          { database: transaction.database, actor, role },
          attachment.cardId,
        );

        await transaction.database
          .deleteFrom('cardAttachment')
          .where('id', '=', attachment.id)
          .execute();

        transaction.appendEvent({
          accountId: card.accountId,
          aggregateType: 'card',
          aggregateId: card.id,
          name: 'files.detached',
          payload: { projectId: card.projectId, fileId: attachment.fileId },
        });
      },
    });

    return outcome.applied ? createCommandSuccess(input.attachmentId) : createCommandSuccess();
  },
});
