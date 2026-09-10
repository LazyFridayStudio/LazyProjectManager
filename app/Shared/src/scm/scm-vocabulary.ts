import { z } from 'zod';

/**
 * Where a project's code lives.
 *
 * Three providers rather than one, because a studio that self-hosts its tracker
 * often self-hosts its forge too. They differ only in how a delivery is signed,
 * which is one function — not a reason to support only the largest of them.
 */
export const SCM_PROVIDERS = ['github', 'gitea', 'gitlab'] as const;

export type ScmProvider = (typeof SCM_PROVIDERS)[number];

export const scmProviderSchema = z.enum(SCM_PROVIDERS);

/** `owner/repository` — owner and repository, as the provider spells it. */
export const repoFullNameSchema = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(
    /^[\w.-]+\/[\w.-]+$/,
    'A repository is written owner/name, as it appears in its own address.',
  );

/** Null for the provider's own host; set for a self-hosted Gitea or GitLab. */
export const scmEndpointSchema = z.string().trim().url().max(500);

/**
 * The shared secret a delivery is signed with.
 *
 * Long, because it is generated rather than typed: nobody has to remember it,
 * so there is no reason to let it be short enough to guess. The lower bound is
 * what stops somebody pasting a word in.
 */
export const webhookSecretSchema = z.string().min(32).max(200);

/**
 * What a repository can tell a card about.
 *
 * All three come out of the delivery itself, which is why there is no fourth.
 * A kind that needed the repository to be opened and read would cost a request
 * per path a push touched, to end up naming something a card cannot show.
 */
export const SCM_LINK_KINDS = ['commit', 'branch', 'pull_request'] as const;

export type ScmLinkKind = (typeof SCM_LINK_KINDS)[number];

export const scmLinkKindSchema = z.enum(SCM_LINK_KINDS);

export function describeScmLinkKind(kind: ScmLinkKind): string {
  return LINK_KIND_LABELS[kind];
}

const LINK_KIND_LABELS: Readonly<Record<ScmLinkKind, string>> = {
  commit: 'Commit',
  branch: 'Branch',
  pull_request: 'Pull request',
};

export function describeScmProvider(provider: ScmProvider): string {
  return PROVIDER_LABELS[provider];
}

const PROVIDER_LABELS: Readonly<Record<ScmProvider, string>> = {
  github: 'GitHub',
  gitea: 'Gitea',
  gitlab: 'GitLab',
};
