export { completeSetupHandler } from './commands/complete-setup.js';

export {
  changePasswordHandler,
  createUserHandler,
  resetUserPasswordHandler,
  setUserRoleHandler,
  setUserStatusHandler,
  updateProfileHandler,
} from './commands/manage-users.js';

export { signInHandler, signOutHandler } from './commands/sign-in.js';
export { meQueryHandler } from './queries/me.js';
export { peopleHandler } from './queries/people.js';

export {
  createSessionCookieWriter,
  readSessionToken,
  SESSION_COOKIE_NAME,
  type SessionCookieWriter,
} from './sessions/session-cookie.js';
export {
  API_TOKEN_PREFIX,
  findActorForApiToken,
  issueApiToken,
  readApiToken,
} from './sessions/api-token-store.js';

export { findActorForSessionToken } from './sessions/session-store.js';
export { findActorForRequest } from './sessions/request-actor.js';
export {
  createAgentHandler,
  issueAgentTokenHandler,
  revokeAgentTokenHandler,
  updateAgentHandler,
} from './commands/agents.js';
export { agentsHandler } from './queries/agents.js';
export { assertIsAnAgent } from './is-an-agent.js';
