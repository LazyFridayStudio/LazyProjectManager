import { DomainError } from '../errors/domain-error.js';

export class ReleaseNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That release does not exist.');
  }
}

/**
 * Two releases on one tag.
 *
 * A conflict rather than a silent second row: a project with two `v0.9.4`s is
 * one where nobody can say which build somebody is running.
 */
export class ReleaseTagTakenError extends DomainError {
  constructor(tag: string) {
    super('CONFLICT', `This project already has a release tagged ${tag}.`);
  }
}
