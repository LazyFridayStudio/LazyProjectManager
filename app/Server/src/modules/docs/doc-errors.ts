import { DomainError } from '../../domain/errors/domain-error.js';

/** No such document, or none this actor is allowed to know about. */
export class DocumentNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That document does not exist.');
  }
}
