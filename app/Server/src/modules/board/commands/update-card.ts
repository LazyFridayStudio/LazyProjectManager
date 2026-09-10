import {
  createCommandSuccess,
  updateCardCommand,
  type CardPriority,
  type CardType,
  type CommandSuccess,
} from '@lpm/shared';

import { defineCommandHandler } from '../../../cqrs/command-registry.js';
import { executeCommand, type CommandTransaction } from '../../../cqrs/execute-command.js';
import { requireActor, type RequestActor } from '../../../cqrs/request-context.js';
import type { MembershipRole } from '../../../domain/index.js';
import { assertProjectPermission, loadMembershipRole } from '../../projects/project-access.js';
import { loadWritableCard } from '../cards/card-access.js';
import { assertPeopleAreOnTheProject } from '../../projects/project-people.js';

interface UpdateCardInput {
  commandId: string;
  cardId: string;
  title?: string;
  type?: CardType;
  priority?: CardPriority | null;
  points?: number | null;
  estimateMinutes?: number | null;
  assigneeId?: string | null;
  reporterId?: string | null;
  milestoneId?: string | null;
  discipline?: string | null;
  fixVersion?: string | null;
  dueOn?: string | null;
  description?: string | null;
  acceptanceCriteria?: string | null;
  blocked?: boolean;
  blockedReason?: string | null;
}

/** Only the fields that were sent are written. Everything else keeps its value. */
interface CardPatch {
  title?: string;
  type?: CardType;
  priority?: CardPriority | null;
  points?: number | null;
  estimateMinutes?: number | null;
  assigneeId?: string | null;
  reporterId?: string | null;
  milestoneId?: string | null;
  discipline?: string | null;
  fixVersion?: string | null;
  dueOn?: string | null;
  description?: string | null;
  acceptanceCriteria?: string | null;
  blocked?: boolean;
  blockedReason?: string | null;
}

/**
 * Edits a card from its detail panel.
 *
 * The card's type can change, and its key does not follow. `DRCH-ART-208` stays
 * that key even if it turns out to be a bug: the key is what somebody put in a
 * commit message, and a key that moved would break that link to make a prefix
 * tidy.
 */
export const updateCardHandler = defineCommandHandler({
  definition: updateCardCommand,

  async execute(input: UpdateCardInput, context): Promise<CommandSuccess> {
    const actor = requireActor(context, updateCardCommand.name);
    const role = await loadMembershipRole(context.database, actor);

    assertProjectPermission({ actor, role, action: 'card.update' });

    const outcome = await executeCommand({
      database: context.database,
      commandName: updateCardCommand.name,
      commandId: input.commandId,
      actorId: actor.userId,
      run: (transaction) => applyUpdate({ transaction, input, actor, role }),
    });

    return outcome.applied ? createCommandSuccess(input.cardId) : createCommandSuccess();
  },
});

interface UpdateCardRequest {
  readonly transaction: CommandTransaction;
  readonly input: UpdateCardInput;
  readonly actor: RequestActor;
  readonly role: MembershipRole;
}

async function applyUpdate(request: UpdateCardRequest): Promise<void> {
  const { transaction, input, actor } = request;

  const card = await loadWritableCard(
    { database: transaction.database, actor, role: request.role },
    input.cardId,
  );

  const patch = buildPatch(input);
  const changedFields = Object.keys(patch);

  if (changedFields.length === 0) {
    return;
  }

  // Before the write, so a card is never briefly given to somebody who cannot
  // open it. The card is loaded by now, which is what says which project to ask
  // about.
  await assertPeopleAreOnTheProject({
    database: transaction.database,
    projectId: card.projectId,
    assigneeId: input.assigneeId,
    reporterId: input.reporterId,
  });

  await transaction.database
    .updateTable('card')
    .set({ ...patch, updatedAt: new Date() })
    .where('id', '=', card.id)
    .execute();

  transaction.appendEvent({
    accountId: card.accountId,
    aggregateType: 'card',
    aggregateId: card.id,
    name: 'board.cardUpdated',
    // The names of what moved, not the values: a card's description is not
    // something the audit trail needs to repeat to everyone allowed to read it.
    payload: { projectId: card.projectId, changedFields },
  });
}

/**
 * The fields an edit copies straight through.
 *
 * A list rather than a branch each: thirteen `if` statements say nothing
 * thirteen names do not, and one of them will eventually be forgotten when a
 * field is added. `satisfies` is what makes sure every name here is real on both
 * sides.
 */
const COPIED_FIELDS = [
  'title',
  'type',
  'priority',
  'points',
  'estimateMinutes',
  'assigneeId',
  'reporterId',
  'milestoneId',
  'discipline',
  'fixVersion',
  'dueOn',
  'description',
  'acceptanceCriteria',
  'blocked',
  'blockedReason',
] as const satisfies readonly (keyof CardPatch & keyof UpdateCardInput)[];

function buildPatch(input: UpdateCardInput): CardPatch {
  const patch: Record<string, unknown> = {};

  for (const field of COPIED_FIELDS) {
    const value = input[field];

    if (value !== undefined) {
      patch[field] = value;
    }
  }

  // Safe because `COPIED_FIELDS` is checked against both shapes above.
  return patch;
}
