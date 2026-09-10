import { DomainError } from '../errors/domain-error.js';

/** A list is already as full as it is allowed to get. */
export class WipLimitReachedError extends DomainError {
  constructor(listName: string, wipLimit: number) {
    super(
      'WIP_LIMIT_REACHED',
      `${listName} is limited to ${String(wipLimit)} cards. Finish something before starting more.`,
    );
  }
}

export interface ListCapacity {
  readonly listName: string;
  /** Null means the list has no limit. */
  readonly wipLimit: number | null;
  /** Open cards already in the list, not counting the one arriving. */
  readonly openCardCount: number;
  /**
   * When set, the limit is a line on the wall rather than a gate.
   *
   * A team that cannot move a card at all because a limit was set optimistically
   * six months ago will work around the tool instead of with it.
   */
  readonly isAdvisory: boolean;
}

/**
 * Refuses a card arriving in a list that is already at its limit.
 *
 * The whole point of a work-in-progress limit is that it says no; a limit that
 * only warns is a number nobody reads. `isAdvisory` is the deliberate way out,
 * set per project.
 */
export function assertListHasRoom(capacity: ListCapacity): void {
  const { wipLimit } = capacity;

  if (wipLimit === null || capacity.isAdvisory) {
    return;
  }

  if (capacity.openCardCount >= wipLimit) {
    throw new WipLimitReachedError(capacity.listName, wipLimit);
  }
}
