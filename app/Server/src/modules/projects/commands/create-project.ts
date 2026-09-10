import {
  CARD_SEQUENCE_PREFIXES,
  createCommandSuccess,
  createProjectCommand,
  type CommandSuccess,
  type ProjectPhase,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import { isUniqueViolation } from '../../../cqrs/unique-violation.js';
import {
  assertProjectScheduleIsOrdered,
  ConflictError,
  DEFAULT_LISTS,
  deriveProjectSlug,
  disambiguateProjectSlug,
  ProjectCodeTakenError,
} from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../project-access.js';

interface CreateProjectInput {
  commandId: string;
  name: string;
  code: string;
  phase: ProjectPhase;
  engine?: string | null;
  budgetMinor?: number | null;
  startsOn?: string | null;
  shipsOn?: string | null;
}

/**
 * Creates a project, the counters that issue its ticket keys, and its first
 * member.
 *
 * All three in one transaction: a project with no counters cannot be given a
 * card, and a project with no members is one nobody can open — including the
 * person who just made it.
 */
export const createProjectHandler = defineCommandHandler({
  definition: createProjectCommand,

  async execute(input: CreateProjectInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, createProjectCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'project.create' });
    assertProjectScheduleIsOrdered(input);

    const outcome = await executeCommand({
      database: context.database,
      commandName: createProjectCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => createProject({ transaction, input, actor }),
    });

    return outcome.applied
      ? createCommandSuccess(outcome.result.projectId)
      : createCommandSuccess();
  },
});

interface CreateProjectRequest {
  readonly transaction: CommandTransaction;
  readonly input: CreateProjectInput;
  readonly actor: RequestActor;
}

async function createProject(request: CreateProjectRequest): Promise<{ projectId: string }> {
  const { transaction, input, actor } = request;

  const project = await insertProject(request, await resolveSlug(request));

  await transaction.database
    .insertInto('cardSequence')
    .values(CARD_SEQUENCE_PREFIXES.map((prefix) => ({ projectId: project.id, prefix })))
    .execute();

  await transaction.database
    .insertInto('projectMember')
    .values({ projectId: project.id, userId: actor.userId, role: 'owner' })
    .execute();

  await createBoard(request, project.id);

  transaction.appendEvent({
    accountId: actor.accountId,
    aggregateType: 'project',
    aggregateId: project.id,
    name: 'projects.projectCreated',
    payload: { name: input.name, code: input.code, slug: project.slug },
  });

  return { projectId: project.id };
}

/**
 * Gives the new project a board with the default lists on it.
 *
 * In the same transaction as the project, because a project you cannot open the
 * board of is not a project anybody can use.
 */
async function createBoard(request: CreateProjectRequest, projectId: string): Promise<void> {
  const { transaction } = request;

  const board = await transaction.database
    .insertInto('board')
    .values({ projectId })
    .returning('id')
    .executeTakeFirstOrThrow();

  await transaction.database
    .insertInto('list')
    .values(
      DEFAULT_LISTS.map((list) => ({
        boardId: board.id,
        name: list.name,
        color: list.color,
        wipLimit: list.wipLimit,
        position: list.position,
      })),
    )
    .execute();
}

/**
 * Picks an address for the project.
 *
 * Two projects can reasonably share a name, so a taken slug falls back to one
 * carrying the code — which is unique within the account, and so needs no
 * counter and no second attempt.
 */
async function resolveSlug(request: CreateProjectRequest): Promise<string> {
  const { transaction, input, actor } = request;
  const preferred = deriveProjectSlug(input.name);

  const taken = await transaction.database
    .selectFrom('project')
    .select('id')
    .where('accountId', '=', actor.accountId)
    .where('slug', '=', preferred)
    .executeTakeFirst();

  return taken === undefined ? preferred : disambiguateProjectSlug(preferred, input.code);
}

async function insertProject(
  request: CreateProjectRequest,
  slug: string,
): Promise<{ id: string; slug: string }> {
  const { transaction, input, actor } = request;

  try {
    return await transaction.database
      .insertInto('project')
      .values({
        accountId: actor.accountId,
        name: input.name,
        code: input.code,
        slug,
        engine: input.engine ?? null,
        phase: input.phase,
        budgetMinor: input.budgetMinor ?? null,
        startsOn: input.startsOn ?? null,
        shipsOn: input.shipsOn ?? null,
        datesTbd: input.startsOn == null && input.shipsOn == null,
      })
      .returning(['id', 'slug'])
      .executeTakeFirstOrThrow();
  } catch (error) {
    if (isUniqueViolation(error, 'project_code_unique_per_account')) {
      throw new ProjectCodeTakenError(input.code);
    }

    // Two projects with the same name created in the same instant: both saw the
    // slug free. Retrying the command resolves it, and the rolled-back
    // `command_log` row means the same command id can be sent again.
    if (isUniqueViolation(error, 'project_slug_unique_per_account')) {
      throw new ConflictError('Another project claimed that name a moment ago. Try again.');
    }

    throw error;
  }
}
