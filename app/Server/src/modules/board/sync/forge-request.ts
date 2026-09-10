import { GithubAppError } from '../../scm/forge/github-app.js';
import type { RepositoryReader } from '../../scm/forge/read-repository.js';

/**
 * One place a request to the forge is actually made.
 *
 * Three things ask now — reading issues, writing labels, writing issues — and
 * they all want the same headers, the same treatment of a status that is an
 * outcome rather than a failure, and the same sentence when the forge says no.
 * Written once, because the third copy of a header list is where one of them
 * quietly stops matching the others.
 */

export interface ForgeRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Relative to the repository, beginning with a slash. */
  readonly path: string;
  readonly body?: Record<string, unknown>;
  /** Statuses that are an outcome rather than a failure. */
  readonly allow?: readonly number[];
  /** What was being attempted, for the sentence a refusal turns into. */
  readonly attempting: 'read' | 'label' | 'write';
}

export async function askForge(reader: RepositoryReader, forge: ForgeRequest): Promise<Response> {
  const response = await reader.fetchImpl(
    `${reader.apiBaseUrl}/repos/${reader.repoFullName}${forge.path}`,
    {
      method: forge.method,
      headers: {
        authorization: `Bearer ${reader.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(forge.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(forge.body === undefined ? {} : { body: JSON.stringify(forge.body) }),
    },
  );

  if (!response.ok && !(forge.allow ?? []).includes(response.status)) {
    throw new GithubAppError(
      describeFailure(response.status, reader.repoFullName, forge.attempting),
    );
  }

  return response;
}

/**
 * What went wrong, in terms somebody configuring this can act on.
 *
 * Which permission is missing depends on what was being attempted, and a studio
 * reading "403" against a repository they can see in their browser learns
 * nothing — what they need is the name of the box to tick.
 */
function describeFailure(
  status: number,
  repoFullName: string,
  attempting: ForgeRequest['attempting'],
): string {
  if (status === 404) {
    return `The app cannot see ${repoFullName}. Check the installation covers this repository.`;
  }

  if (status === 401 || status === 403) {
    if (attempting === 'read') {
      return `The app is not allowed to read issues from ${repoFullName}. Give it read access to issues, and check the installation.`;
    }

    return attempting === 'label'
      ? `The app is not allowed to label issues on ${repoFullName}. Give it write access to issues, not just read.`
      : `The app is not allowed to raise or change issues on ${repoFullName}. Give it write access to issues, not just read.`;
  }

  return `The forge answered ${String(status)} when asked to ${describeAttempt(attempting)} on ${repoFullName}.`;
}

function describeAttempt(attempting: ForgeRequest['attempting']): string {
  if (attempting === 'read') {
    return 'read the issues';
  }

  return attempting === 'label' ? 'label an issue' : 'write an issue';
}
