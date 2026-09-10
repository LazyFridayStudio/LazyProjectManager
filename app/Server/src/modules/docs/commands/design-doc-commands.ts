import {
  createCommandSuccess,
  createDesignDocCommand,
  deleteDesignDocCommand,
  EMPTY_DOCUMENT,
  moveDesignDocCommand,
  nextDocumentName,
  renameDesignDocCommand,
  updateDesignDocCommand,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import {
  placeAmong,
  positionBetween,
  ProjectArchivedError,
  type PermittedAction,
  type PlacedRow,
} from '../../../domain/index.js';
import {
  assertProjectPermission,
  loadMembershipRole,
  loadProjectForWrite,
} from '../../projects/project-access.js';
import { binIt } from '../../recovery/index.js';
import { DocumentNotFoundError } from '../doc-errors.js';

/**
 * Adds a document to a project.
 *
 * `card.update` rather than a permission of its own: writing the design down is
 * the same kind of act as writing a card, and anybody trusted with one is
 * trusted with the other.
 */
export const createDesignDocHandler = defineCommandHandler({
  definition: createDesignDocCommand,

  async execute(
    input: { commandId: string; projectId: string; title?: string; body?: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, createDesignDocCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'doc.create' });

    let docId: string | undefined;

    const outcome = await executeCommand({
      database: context.database,
      commandName: createDesignDocCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const project = await loadProjectForWrite(transaction.database, actor, input.projectId);

        if (project.archivedAt !== null) {
          throw new ProjectArchivedError();
        }

        // Every document the project keeps, because both the name and the
        // place at the end of the row are worked out from them — and inside
        // this transaction, so two people adding one at the same moment cannot
        // both find `New doc` free.
        const existing = await transaction.database
          .selectFrom('projectDoc')
          .select(['title', 'position'])
          .where('projectId', '=', project.id)
          .orderBy('position', 'desc')
          .execute();

        const last = existing[0];
        const imported = input.body !== undefined && input.body !== '';

        const created = await transaction.database
          .insertInto('projectDoc')
          .values({
            accountId: actor.accountId,
            projectId: project.id,
            title: input.title ?? nextDocumentName(existing.map((each) => each.title)),
            // Whatever an import carried, or nothing for a document somebody
            // is about to write themselves.
            body: input.body ?? EMPTY_DOCUMENT,
            // An import is a piece of writing that arrived, so it has an
            // author. A blank document has not been written by anybody yet,
            // and saying otherwise would put a name against an empty page.
            updatedBy: imported ? actor.userId : null,
            // A new document goes at the end of the row of tabs.
            position: positionBetween(last === undefined ? null : Number(last.position), null),
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        docId = created.id;

        transaction.appendEvent({
          accountId: actor.accountId,
          aggregateType: 'project',
          aggregateId: project.id,
          name: 'docs.documentCreated',
          payload: { projectId: project.id, docId: created.id },
        });
      },
    });

    return outcome.applied && docId !== undefined
      ? createCommandSuccess(docId)
      : createCommandSuccess();
  },
});

export const renameDesignDocHandler = defineCommandHandler({
  definition: renameDesignDocCommand,

  async execute(
    input: { commandId: string; docId: string; title: string },
    context,
  ): Promise<CommandSuccess> {
    return writeDocument({
      context,
      commandId: input.commandId,
      commandName: renameDesignDocCommand.name,
      action: 'doc.update',
      run: async (write) => {
        const document = await loadDocumentForWrite(write, input.docId);

        await write.transaction.database
          .updateTable('projectDoc')
          .set({ title: input.title, updatedAt: new Date(), updatedBy: write.actor.userId })
          .where('id', '=', document.id)
          .execute();

        return { projectId: document.projectId, id: document.id, event: 'docs.documentRenamed' };
      },
    });
  },
});

export const updateDesignDocHandler = defineCommandHandler({
  definition: updateDesignDocCommand,

  async execute(
    input: { commandId: string; docId: string; body: string },
    context,
  ): Promise<CommandSuccess> {
    return writeDocument({
      context,
      commandId: input.commandId,
      commandName: updateDesignDocCommand.name,
      action: 'doc.update',
      run: async (write) => {
        const document = await loadDocumentForWrite(write, input.docId);

        await write.transaction.database
          .updateTable('projectDoc')
          .set({ body: input.body, updatedAt: new Date(), updatedBy: write.actor.userId })
          .where('id', '=', document.id)
          .execute();

        return { projectId: document.projectId, id: document.id, event: 'docs.documentWritten' };
      },
    });
  },
});

/**
 * Moves a document along the row of tabs.
 *
 * `doc.update` rather than a permission of its own: the row is part of the
 * design document the way its headings are, and anybody who may write one may
 * say what order they read in.
 *
 * It deliberately does not touch `updatedAt` or `updatedBy`. The header says
 * when the prose was last written and by whom, which is the question a studio
 * asks of a design document before it reads one — and dragging a tab is not an
 * answer to it.
 */
export const moveDesignDocHandler = defineCommandHandler({
  definition: moveDesignDocCommand,

  async execute(
    input: {
      commandId: string;
      docId: string;
      beforeDocId?: string | null;
      afterDocId?: string | null;
    },
    context,
  ): Promise<CommandSuccess> {
    return writeDocument({
      context,
      commandId: input.commandId,
      commandName: moveDesignDocCommand.name,
      action: 'doc.update',
      run: async (write) => {
        const document = await loadDocumentForWrite(write, input.docId);
        const database = write.transaction.database;

        // Without itself: it is being taken out and put back, and leaving it in
        // makes a move by one place land on the position it already had.
        const others = (await documentsInProject(write, document.projectId)).filter(
          (row) => row.id !== document.id,
        );
        const landing = placeAmong(others, {
          before: input.beforeDocId,
          after: input.afterDocId,
        });

        for (const row of landing.spread) {
          await database
            .updateTable('projectDoc')
            .set({ position: row.position })
            .where('id', '=', row.id)
            .execute();
        }

        await database
          .updateTable('projectDoc')
          .set({ position: landing.position })
          .where('id', '=', document.id)
          .execute();

        return { projectId: document.projectId, id: document.id, event: 'docs.documentMoved' };
      },
    });
  },
});

/** Every document in the project, in the order the tabs draw them. */
async function documentsInProject(
  write: { transaction: CommandTransaction },
  projectId: string,
): Promise<PlacedRow[]> {
  const rows = await write.transaction.database
    .selectFrom('projectDoc')
    .select(['id', 'position'])
    .where('projectId', '=', projectId)
    .orderBy('position')
    .orderBy('createdAt')
    .execute();

  // `numeric` arrives from `pg` as a string, so every read goes through here.
  return rows.map((row) => ({ id: row.id, position: Number(row.position) }));
}

export const deleteDesignDocHandler = defineCommandHandler({
  definition: deleteDesignDocCommand,

  async execute(input: { commandId: string; docId: string }, context): Promise<CommandSuccess> {
    return writeDocument({
      context,
      commandId: input.commandId,
      commandName: deleteDesignDocCommand.name,
      action: 'doc.delete',
      run: async (write) => {
        const document = await loadDocumentForWrite(write, input.docId);

        // A document is somebody's afternoon of writing. It waits in the bin
        // for a week before it is really gone.
        await binIt({
          transaction: write.transaction,
          kind: 'projectDoc',
          accountId: write.actor.accountId,
          actorId: write.actor.userId,
          subjectId: document.id,
          projectId: document.projectId,
          name: document.title,
        });

        await write.transaction.database
          .deleteFrom('projectDoc')
          .where('id', '=', document.id)
          .execute();

        return { projectId: document.projectId, id: document.id, event: 'docs.documentDeleted' };
      },
    });
  },
});

interface Write {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
}

interface Written {
  readonly projectId: string;
  readonly id: string;
  readonly event: string;
}

/**
 * The three commands that change a document somebody names by id.
 *
 * They differ by one statement each; the permission check, the transaction and
 * the event are the same three lines written once rather than three times.
 */
async function writeDocument(request: {
  readonly context: Parameters<Parameters<typeof defineCommandHandler>[0]['execute']>[1];
  readonly commandId: string;
  readonly commandName: string;
  /**
   * Which permission this particular write needs.
   *
   * Passed in rather than fixed here, because three commands share this
   * function and they are not the same act: writing in a document and deleting
   * one are the difference between a typo and a morning's work gone.
   */
  readonly action: PermittedAction;
  readonly run: (write: Write) => Promise<Written>;
}): Promise<CommandSuccess> {
  const { context, commandId, commandName, action, run } = request;
  const actor = requireActor(context, commandName);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action });

  let written: Written | undefined;

  const outcome = await executeCommand({
    database: context.database,
    commandName,
    commandId,
    actorId: actor.userId,
    run: async (transaction) => {
      written = await run({ transaction, actor });

      transaction.appendEvent({
        accountId: actor.accountId,
        aggregateType: 'project',
        aggregateId: written.projectId,
        name: written.event,
        payload: { projectId: written.projectId, docId: written.id },
      });
    },
  });

  return outcome.applied && written !== undefined
    ? createCommandSuccess(written.id)
    : createCommandSuccess();
}

/**
 * The document a command names, once it is established the caller may write it.
 *
 * Scoped by account before anything else: another account's document is not
 * found rather than forbidden, because a "forbidden" tells somebody the id they
 * guessed at was real.
 */
async function loadDocumentForWrite(
  write: Write,
  docId: string,
): Promise<{ id: string; projectId: string; title: string }> {
  const document = await write.transaction.database
    .selectFrom('projectDoc')
    .select(['id', 'projectId', 'title'])
    .where('id', '=', docId)
    .where('accountId', '=', write.actor.accountId)
    .executeTakeFirst();

  if (document === undefined) {
    throw new DocumentNotFoundError();
  }

  const project = await loadProjectForWrite(
    write.transaction.database,
    write.actor,
    document.projectId,
  );

  if (project.archivedAt !== null) {
    throw new ProjectArchivedError();
  }

  return document;
}
