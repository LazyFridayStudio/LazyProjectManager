import { DomainError } from '../errors/domain-error.js';

/** No such milestone, or none this actor is allowed to know about. */
export class MilestoneNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That milestone does not exist.');
  }
}

/** A milestone that ends before it starts is a typo, not a plan. */
export class MilestoneOutOfOrderError extends DomainError {
  constructor() {
    super('CONFLICT', 'A milestone cannot end before it starts.');
  }
}
