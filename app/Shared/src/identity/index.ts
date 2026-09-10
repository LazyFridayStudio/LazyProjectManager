export {
  completeSetupCommand,
  displayNameSchema,
  emailSchema,
  passwordSchema,
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
} from './commands/complete-setup.js';

export {
  changePasswordCommand,
  createUserCommand,
  initialsSchema,
  resetUserPasswordCommand,
  setUserRoleCommand,
  setUserStatusCommand,
  updateProfileCommand,
} from './commands/manage-users.js';

export { describeRole, summariseRole, ROLE_ORDER } from './role-vocabulary.js';

export { signInCommand, signOutCommand } from './commands/sign-in.js';

export {
  peopleQuery,
  peopleViewSchema,
  personSchema,
  personStatusSchema,
  PEOPLE_PAGE_SIZE,
  type PeopleView,
  type Person,
  type PersonStatus,
} from './queries/people.js';

export {
  meQuery,
  membershipRoleSchema,
  membershipSchema,
  meViewSchema,
  signedInUserSchema,
  THEMES,
  themeSchema,
  type Theme,
  type MembershipRoleName,
  type MeView,
} from './queries/me.js';
export {
  createAgentCommand,
  issueAgentTokenCommand,
  revokeAgentTokenCommand,
  updateAgentCommand,
  tokenNameSchema,
} from './commands/agents.js';
export {
  agentsQuery,
  agentSchema,
  agentTokenSchema,
  agentsViewSchema,
  type Agent,
  type AgentToken,
  type AgentsView,
} from './queries/agents.js';

export {
  themeColorsSchema,
  THEME_COLOR_NAMES,
  type ThemeColorName,
  type ThemeColors,
} from './theme-colors.js';
