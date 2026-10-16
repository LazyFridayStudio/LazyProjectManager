import {
  applyAssetTemplateCommand,
  createAssetTemplateCommand,
  createCommandSuccess,
  deleteAssetTemplateCommand,
  updateAssetTemplateCommand,
  type AssetTemplateDefinition,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import {
  requireActor,
  type RequestActor,
  type RequestContext,
} from '../../../cqrs/request-context.js';
import { isUniqueViolation } from '../../../cqrs/unique-violation.js';
import {
  AssetTemplateNameTakenError,
  AssetTemplateNotFoundError,
  type MembershipRole,
} from '../../../domain/index.js';
import { loadWritableProject } from '../../board/cards/card-access.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { appendAssetEvent, loadWritableAsset } from '../asset-access.js';
import { addTabsFromTemplate, loadTemplateOfProject } from '../asset-template-tabs.js';

/**
 * A project's templates: sets of tabs to start an asset from.
 *
 * Keeping them is `asset.manageTemplate`, beside `asset.manageCategory`: both
 * are how a project's library is set up rather than what is in it, and a studio
 * that lets everybody fill the library in does not necessarily let everybody
 * decide what a creature is made of. Applying one is changing an asset, and is
 * `asset.update`.
 */

const NAME_CONSTRAINT = 'asset_template_name_unique';

interface TemplateAccess {
  readonly transaction: CommandTransaction;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function onTemplates(
  context: RequestContext,
  command: { readonly name: string; readonly commandId: string },
  run: (access: TemplateAccess) => Promise<string>,
): Promise<CommandSuccess> {
  const actor = requireActor(context, command.name);
  const role = await loadMembershipRole(context.database, actor);

  assertProjectPermission({ actor, role, action: 'asset.manageTemplate' });

  const outcome = await executeCommand({
    database: context.database,
    commandName: command.name,
    commandId: command.commandId,
    actorId: actor.userId,
    run: (transaction) => run({ transaction, actor, role }),
  });

  return outcome.applied ? createCommandSuccess(outcome.result) : createCommandSuccess();
}

/** Says a template changed, on the project it belongs to. Its name is not secret. */
function appendTemplateEvent(
  transaction: CommandTransaction,
  template: { readonly accountId: string; readonly projectId: string; readonly id: string },
  name: string,
): void {
  transaction.appendEvent({
    accountId: template.accountId,
    aggregateType: 'project',
    aggregateId: template.projectId,
    name,
    payload: { projectId: template.projectId, templateId: template.id },
  });
}

/** A clash on the name, said as one rather than as a constraint. */
function refusingATakenName<TResult>(
  name: string,
  write: () => Promise<TResult>,
): Promise<TResult> {
  return write().catch((error: unknown) => {
    if (isUniqueViolation(error, NAME_CONSTRAINT)) {
      throw new AssetTemplateNameTakenError(name);
    }

    throw error;
  });
}

/** Keeps a set of tabs for the project to start assets from. */
export const createAssetTemplateHandler = defineCommandHandler({
  definition: createAssetTemplateCommand,

  execute(
    input: {
      commandId: string;
      projectId: string;
      name: string;
      definition: AssetTemplateDefinition;
    },
    context,
  ): Promise<CommandSuccess> {
    return onTemplates(
      context,
      { name: createAssetTemplateCommand.name, commandId: input.commandId },
      async ({ transaction, actor, role }) => {
        const project = await loadWritableProject(
          { database: transaction.database, actor, role },
          input.projectId,
        );

        const template = await refusingATakenName(input.name, () =>
          transaction.database
            .insertInto('assetTemplate')
            .values({
              accountId: project.accountId,
              projectId: project.projectId,
              name: input.name,
              definition: JSON.stringify(input.definition),
            })
            .returning('id')
            .executeTakeFirstOrThrow(),
        );

        appendTemplateEvent(
          transaction,
          { accountId: project.accountId, projectId: project.projectId, id: template.id },
          'assets.templateCreated',
        );

        return template.id;
      },
    );
  },
});

interface StoredTemplate {
  readonly id: string;
  readonly accountId: string;
  readonly projectId: string;
}

/** A template somebody may change: in their account, on a project they may write to. */
async function loadWritableTemplate(
  access: TemplateAccess,
  templateId: string,
): Promise<StoredTemplate> {
  const template = await access.transaction.database
    .selectFrom('assetTemplate')
    .select(['id', 'accountId', 'projectId'])
    .where('id', '=', templateId)
    .where('accountId', '=', access.actor.accountId)
    .executeTakeFirst();

  if (template === undefined) {
    throw new AssetTemplateNotFoundError();
  }

  await loadWritableProject(
    { database: access.transaction.database, actor: access.actor, role: access.role },
    template.projectId,
  );

  return template;
}

/**
 * Renames a template, or replaces what is in it.
 *
 * Assets already started from it keep the tabs they were given: a template is
 * where an asset starts, not a rule it goes on following.
 */
export const updateAssetTemplateHandler = defineCommandHandler({
  definition: updateAssetTemplateCommand,

  execute(
    input: {
      commandId: string;
      templateId: string;
      name?: string;
      definition?: AssetTemplateDefinition;
    },
    context,
  ): Promise<CommandSuccess> {
    return onTemplates(
      context,
      { name: updateAssetTemplateCommand.name, commandId: input.commandId },
      async (access) => {
        const template = await loadWritableTemplate(access, input.templateId);
        const patch: { name?: string; definition?: string } = {};

        if (input.name !== undefined) patch.name = input.name;

        if (input.definition !== undefined) patch.definition = JSON.stringify(input.definition);

        await refusingATakenName(input.name ?? '', () =>
          access.transaction.database
            .updateTable('assetTemplate')
            .set(patch)
            .where('id', '=', template.id)
            .execute(),
        );

        appendTemplateEvent(access.transaction, template, 'assets.templateUpdated');

        return template.id;
      },
    );
  },
});

/**
 * Deletes a template.
 *
 * Not binned: it is a starting point rather than work, and every asset started
 * from it still has its tabs. A category that offered it offers nothing, which
 * the database does by emptying the column.
 */
export const deleteAssetTemplateHandler = defineCommandHandler({
  definition: deleteAssetTemplateCommand,

  execute(input: { commandId: string; templateId: string }, context): Promise<CommandSuccess> {
    return onTemplates(
      context,
      { name: deleteAssetTemplateCommand.name, commandId: input.commandId },
      async (access) => {
        const template = await loadWritableTemplate(access, input.templateId);

        await access.transaction.database
          .deleteFrom('assetTemplate')
          .where('id', '=', template.id)
          .execute();

        appendTemplateEvent(access.transaction, template, 'assets.templateDeleted');

        return template.id;
      },
    );
  },
});

/**
 * Adds a template's tabs to an asset, after the ones it has.
 *
 * Behind `asset.update` rather than the template permission: it changes the
 * asset and not the template, and somebody filling a library in is exactly who
 * starts an asset from one.
 */
export const applyAssetTemplateHandler = defineCommandHandler({
  definition: applyAssetTemplateCommand,

  async execute(
    input: { commandId: string; assetId: string; templateId: string },
    context,
  ): Promise<CommandSuccess> {
    const actor = requireActor(context, applyAssetTemplateCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'asset.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: applyAssetTemplateCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: async (transaction) => {
        const asset = await loadWritableAsset({ transaction, actor, role }, input.assetId);
        const definition = await loadTemplateOfProject(transaction, {
          actor,
          projectId: asset.projectId,
          templateId: input.templateId,
        });

        await addTabsFromTemplate(transaction, asset, definition);

        appendAssetEvent(transaction, asset, 'assets.templateApplied');
      },
    });

    return outcome.applied ? createCommandSuccess(input.assetId) : createCommandSuccess();
  },
});
