import { ConflictError, DomainError } from '../errors/domain-error.js';

/**
 * Another project in this account already uses this code.
 *
 * Named rather than generic because the create form has a field to point at:
 * the code is the one thing a person has to choose and cannot change later.
 */
export class ProjectCodeTakenError extends ConflictError {
  constructor(code: string) {
    super(`Another project already uses the code ${code}.`, { code: 'That code is taken.' });
  }
}

/** No such project, or none this actor is allowed to know about. */
export class ProjectNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That project does not exist.');
  }
}

/** The project is archived, and archived projects are read-only. */
export class ProjectArchivedError extends DomainError {
  constructor() {
    super('INVARIANT_VIOLATED', 'That project is archived. Restore it before making changes.');
  }
}
