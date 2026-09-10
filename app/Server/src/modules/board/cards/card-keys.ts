import type { DatabaseTransaction } from '@lpm/database';
import { formatCardKey, getPrefixForCardType, type CardType } from '@lpm/shared';

export interface AllocateCardKeyRequest {
  readonly database: DatabaseTransaction;
  readonly projectId: string;
  /** The project's code, which is the root of the key: `DRCH`. */
  readonly projectCode: string;
  readonly cardType: CardType;
}

/**
 * Takes the next ticket key for a project.
 *
 * The counter row is updated and read back in one statement, so two people
 * creating a card at the same instant take different numbers — Postgres
 * serialises them on the row lock. Reading then writing would hand both of them
 * the same key.
 *
 * Runs inside the caller's transaction, which is what makes a rolled-back create
 * give its number back instead of leaving a gap in the sequence.
 */
export async function allocateCardKey(request: AllocateCardKeyRequest): Promise<string> {
  const { database, projectId, projectCode, cardType } = request;
  const prefix = getPrefixForCardType(cardType);

  const sequence = await database
    .updateTable('cardSequence')
    .set((expression) => ({ lastValue: expression('lastValue', '+', 1) }))
    .where('projectId', '=', projectId)
    .where('prefix', '=', prefix)
    .returning('lastValue')
    .executeTakeFirstOrThrow();

  return formatCardKey(projectCode, prefix, sequence.lastValue);
}
