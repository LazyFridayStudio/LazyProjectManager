import { DomainError } from '../../domain/index.js';

/**
 * Nothing in the bin under that id.
 *
 * Also what another account's bin row looks like, and what one that somebody
 * else has already put back looks like — two admins on the same screen is the
 * ordinary way this happens.
 */
export class DeletedThingNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That is not in the bin. It may already have been put back.');
  }
}
