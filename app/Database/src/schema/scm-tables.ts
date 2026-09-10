import type { ScmLinkKind, ScmProvider } from '@lpm/shared';
import type { ColumnType, Generated, JSONColumnType } from 'kysely';

/**
 * Table types for a project's repository and what it has told us.
 *
 * The payload stays as it arrived. What an event means is worked out later, so a
 * parser that turns out to be wrong can be fixed and re-run against what
 * actually happened.
 */

type CreatedAt = ColumnType<Date, Date | undefined, never>;

export interface ScmConnectionTable {
  id: Generated<string>;
  accountId: string;
  projectId: string;
  provider: ScmProvider;
  repoFullName: string;
  /** Null for the provider's own host; set for a self-hosted Gitea or GitLab. */
  endpoint: string | null;
  /** Encrypted at rest. Verifying a signature needs the secret, not a hash of it. */
  webhookSecretEnc: string;
  /**
   * A GitHub App, for reading the repository rather than only hearing from it.
   *
   * All three together or none — the database holds that. A webhook tells us a
   * push happened and names the paths; reading what is inside one needs a token.
   */
  appId: string | null;
  installationId: string | null;
  /** Encrypted at rest: signing needs the key, so a hash would be no use. */
  privateKeyEnc: string | null;
  /** When the credentials were last known to work. */
  accessCheckedAt: Date | null;
  connectedAt: CreatedAt;
  connectedBy: string | null;
  /** Null until the first delivery, which is how "is this wired up?" is answered. */
  lastEventAt: Date | null;
  /**
   * When releases were last read from the repository.
   *
   * Null until somebody has pulled once, which is how the Builds page tells
   * "never synced" from "synced, and the repository had nothing".
   */
  releasesSyncedAt: Date | null;
  issuesSyncedAt: Date | null;
  /**
   * When the forge last said something this board may not have caught up with.
   *
   * Set by a delivery, read by the sweep, and never cleared: a reconcile that
   * lands afterwards moves `issuesSyncedAt` past it, which is what makes the
   * connection no longer due. Two columns because they are two facts — when we
   * last looked, and when there was last anything to look at.
   */
  forgeSpokeAt: Date | null;
  /**
   * Set while a sync holds this connection, so a second one does not start.
   *
   * Claimed and released by `claimTheSync`, which also honours the lease on it:
   * a claim older than the longest a sync could take is taken over, because a
   * worker killed mid-sync must not leave a connection nothing can ever sync
   * again.
   */
  syncingSince: Date | null;
  /**
   * When the last attempt failed, and why, in words a person can act on.
   *
   * Both cleared by the next sync that works. Without them a repository whose
   * every attempt fails shows an ageing "synced N hours ago" and nothing else,
   * which reads exactly like a repository nobody has touched.
   */
  syncFailedAt: Date | null;
  syncFailure: string | null;
}

export interface ScmEventRawTable {
  id: Generated<string>;
  connectionId: string;
  deliveryId: string;
  eventName: string;
  /** The delivery exactly as it arrived; a forge sends an object at the root. */
  payload: JSONColumnType<Record<string, unknown>>;
  receivedAt: CreatedAt;
  /** Null until the worker has read it. */
  processedAt: Date | null;
}

/**
 * One reading of what a repository said about a card.
 *
 * Derived, never authoritative: `scm_event_raw` is the record, and these rows
 * can be cleared and rebuilt from it.
 */
export interface ScmLinkTable {
  id: Generated<string>;
  cardId: string;
  connectionId: string;
  kind: ScmLinkKind;
  /** The commit sha, the branch name, or `#41` — whatever names this thing. */
  ref: string;
  url: string | null;
  author: string | null;
  message: string | null;
  /** When it happened in the repository, not when we heard about it. */
  occurredAt: Date;
}

/**
 * An issue this board has turned down, so the sync stops offering it.
 *
 * Written when a card that came from a repository is deleted. Without it the
 * next sync sees an issue with no card and makes one, which would undo the
 * delete on a timer.
 */
export interface DismissedIssueTable {
  id: Generated<string>;
  accountId: string;
  projectId: string;
  /** The forge's own id, which is what `card.external_id` holds. */
  externalId: string;
  dismissedAt: CreatedAt;
}
