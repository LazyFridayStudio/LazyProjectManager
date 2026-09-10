import type { RepositoryReader } from '../../scm/forge/read-repository.js';
import { askForge } from './forge-request.js';
import type { IssueLabelChange } from './plan-issue-labels.js';

/**
 * Putting the board's answer back on the repository.
 *
 * This is the only thing in the whole integration that writes. Everything else
 * reads: deliveries arrive, releases and issues are fetched, and nothing is
 * pushed back. So it is deliberately narrow — it adds and removes labels whose
 * names are the names of lists, on issues that already have a card, and it
 * touches nothing else about an issue.
 */

/** A colour for a label this is about to invent, as the forge wants it: six hex digits, no hash. */
export interface BoardLabel {
  readonly name: string;
  readonly color: string;
}

export interface LabelWrite {
  readonly reader: RepositoryReader;
  readonly changes: readonly IssueLabelChange[];
  /** Every list on the board, so a label that has to be invented looks like the list. */
  readonly boardLabels: readonly BoardLabel[];
}

/**
 * Applies the changes, creating any label the repository has never seen.
 *
 * Labels first, and only the ones actually about to be used: a board with eight
 * lists should not put eight labels on a repository that only ever sees three of
 * them.
 */
export async function writeIssueLabels(write: LabelWrite): Promise<void> {
  const wanted = new Set(
    write.changes.map((change) => change.add).filter((name): name is string => name !== null),
  );

  if (wanted.size > 0) {
    await createMissingLabels(write, wanted);
  }

  for (const change of write.changes) {
    // Off before on, so an issue is never briefly wearing two of them — a board
    // that says a card is in two lists at once is worse than one that is a
    // moment behind.
    for (const label of change.remove) {
      await removeLabel(write.reader, change.ref, label);
    }

    if (change.add !== null) {
      await addLabel(write.reader, change.ref, change.add);
    }
  }
}

/**
 * Creates the labels the repository does not have yet.
 *
 * Asked for rather than assumed: adding an unknown label to an issue is refused
 * by the forge, and creating one that already exists is refused too, so the list
 * is read once and the difference is what gets made.
 */
async function createMissingLabels(write: LabelWrite, wanted: Set<string>): Promise<void> {
  const existing = await readLabelNames(write.reader);

  for (const label of write.boardLabels) {
    if (!wanted.has(label.name) || existing.has(label.name.toLowerCase())) {
      continue;
    }

    await askForge(write.reader, {
      method: 'POST',
      path: '/labels',
      attempting: 'label',
      // The list's own colour, so the label on the forge looks like the column
      // on the board rather than GitHub's default grey.
      body: { name: label.name, color: label.color },
      // A label somebody created a second ago is not a failure worth stopping
      // for; the add below is what actually matters.
      allow: [422],
    });
  }
}

async function readLabelNames(reader: RepositoryReader): Promise<Set<string>> {
  const response = await askForge(reader, {
    method: 'GET',
    path: '/labels?per_page=100',
    attempting: 'label',
  });
  const payload: unknown = await response.json();

  if (!Array.isArray(payload)) {
    return new Set();
  }

  return new Set(
    payload.flatMap((each: unknown) => {
      const name =
        typeof each === 'object' && each !== null ? (each as { name?: unknown }).name : null;

      return typeof name === 'string' ? [name.toLowerCase()] : [];
    }),
  );
}

function addLabel(reader: RepositoryReader, ref: string, label: string): Promise<Response> {
  return askForge(reader, {
    method: 'POST',
    path: `/issues/${encodeURIComponent(ref)}/labels`,
    body: { labels: [label] },
    attempting: 'label',
  });
}

function removeLabel(reader: RepositoryReader, ref: string, label: string): Promise<Response> {
  return askForge(reader, {
    method: 'DELETE',
    path: `/issues/${encodeURIComponent(ref)}/labels/${encodeURIComponent(label)}`,
    attempting: 'label',
    // Already gone is the outcome this wanted. Two syncs racing, or somebody
    // taking it off by hand, are both ordinary.
    allow: [404],
  });
}
