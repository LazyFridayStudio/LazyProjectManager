import { DomainError } from '../errors/domain-error.js';

/** No such card, or none this actor is allowed to know about. */
export class CardNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That card does not exist.');
  }
}

/**
 * The list a card is being put in is not on this project's board.
 *
 * Separated from "no such list" on purpose: moving a card into another project's
 * list is a different mistake from moving it into one that was archived, and the
 * message a person sees should say which.
 */
export class ListNotOnBoardError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That list is not on this board.');
  }
}

/** The card's project is archived, and archived projects are read-only. */
export class CardProjectArchivedError extends DomainError {
  constructor() {
    super('INVARIANT_VIOLATED', 'That project is archived. Restore it before making changes.');
  }
}
