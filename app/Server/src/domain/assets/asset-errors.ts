import { DomainError } from '../errors/domain-error.js';

/**
 * The category an asset is being filed under is not in this project.
 *
 * Separate from "no such category" on purpose: filing an asset into another
 * project's category is a different mistake from filing it into one that was
 * archived, and the message should say which.
 */
export class AssetCategoryNotInProjectError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That category is not in this project.');
  }
}

/** No such asset, or none this actor is allowed to know about. */
export class AssetNotFoundError extends DomainError {
  constructor() {
    super('NOT_FOUND', 'That asset does not exist.');
  }
}

/** Two categories with one name is a library nobody can file anything in. */
export class AssetCategoryNameTakenError extends DomainError {
  constructor(name: string) {
    super('CONFLICT', `This project already has a category called ${name}.`);
  }
}
