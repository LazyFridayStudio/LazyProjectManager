export {
  createCommandRegistry,
  defineCommandHandler,
  type CommandHandler,
} from './command-registry.js';

export { createQueryRegistry, defineQueryHandler, type QueryHandler } from './query-registry.js';

export { computeEtag, matchesClientEtag } from './compute-etag.js';

export { registerCqrsRoutes, type CqrsRouteOptions } from './register-cqrs-routes.js';

export { requireActor, type RequestActor, type RequestContext } from './request-context.js';

export { isUniqueViolation } from './unique-violation.js';
