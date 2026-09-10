import {
  projectPeopleQuery,
  SIGIL_BY_KIND,
  writeCommentMark,
  type CommentMark,
  type ProjectPeopleView,
} from '@lpm/shared';
import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../../components/ApiClientProvider.js';

/** What somebody has started typing after a sigil, and where it began. */
export interface MarkBeingTyped {
  readonly sigil: '@' | '#';
  readonly query: string;
  /** Where the sigil is, so replacing it does not disturb the rest. */
  readonly from: number;
}

/**
 * Everything before the caret, back to the sigil that started this word.
 *
 * A picker opens on the run somebody is typing rather than on the whole box, so
 * `@al` offers people and `look at @alex and #cra` offers cards — the sigil in
 * play is the last one, and it stops at whitespace because a name with a space
 * in it is still chosen from a list rather than typed out.
 *
 * Null when the caret is not in one, which is most of the time and must cost
 * nothing: this runs on every keystroke of every comment anybody writes.
 */
export function readMarkBeingTyped(body: string, caret: number): MarkBeingTyped | null {
  const before = body.slice(0, caret);
  const lastAt = before.lastIndexOf('@');
  const lastHash = before.lastIndexOf('#');
  const from = Math.max(lastAt, lastHash);

  if (from === -1) {
    return null;
  }

  const run = before.slice(from + 1);

  // A space ends it. So does a bracket, which means the sigil belongs to a mark
  // already written rather than to a word being typed.
  if (/[\s[\]()]/u.test(run)) {
    return null;
  }

  // Mid-word: `name@example.com` is an address, not a mention.
  const beforeSigil = before.charAt(from - 1);

  if (from > 0 && !/\s/u.test(beforeSigil)) {
    return null;
  }

  return { sigil: from === lastAt ? '@' : '#', query: run, from };
}

/**
 * Puts a chosen mark into what somebody was typing, in place of the run.
 *
 * Returns the new body and where the caret should sit — after the mark and a
 * space, because the next thing anybody types is the rest of the sentence.
 */
export function replaceMarkBeingTyped(
  body: string,
  typed: MarkBeingTyped,
  mark: CommentMark,
): { body: string; caret: number } {
  const after = body.slice(typed.from + 1 + typed.query.length);
  // A space after it, unless the sentence already has one there — choosing a
  // name in the middle of a line should not leave a gap somebody has to go back
  // and close.
  const written = `${writeCommentMark(mark)}${/^\s/u.test(after) ? '' : ' '}`;

  return { body: body.slice(0, typed.from) + written + after, caret: typed.from + written.length };
}

/**
 * The people on this project who match what is being typed after an `@`.
 *
 * Everybody who reaches the project, which is not the same as everybody named on
 * it: somebody there through a team can open the card and is worth telling. The
 * server decides that, and refuses to record a mention of anybody it would not
 * have offered here.
 */
export function useMentionable(projectId: string, typed: MarkBeingTyped | null): ProjectPeopleView {
  const { client, baseUrl } = useApiClient();
  const search = typed?.sigil === '@' ? typed.query : null;

  const found = useQuery({
    queryKey: ['project-people', baseUrl, projectId, search],
    queryFn: () => client.query(projectPeopleQuery, { projectId, search: search ?? '' }),
    enabled: search !== null,
    // A project's people change far more slowly than somebody types.
    staleTime: 30_000,
  });

  return search === null ? NOBODY : (found.data ?? NOBODY);
}

const NOBODY: ProjectPeopleView = { people: [], more: 0 };

/** The sigil a kind is written with, for a picker drawing its own hint. */
export { SIGIL_BY_KIND };
