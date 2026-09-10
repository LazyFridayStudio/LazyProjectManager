/**
 * Which label an issue should be wearing, and which to take off it.
 *
 * The board is the answer to "where is this up to", and an issue on GitHub says
 * nothing about that unless somebody puts it there. So the list a card sits on
 * becomes a label on the issue behind it: `Backlog`, `In progress`, whatever the
 * lists on that board are actually called.
 *
 * Pure, and separate from the requests it turns into, because the interesting
 * part is what to change rather than how to ask — and "leave an issue alone
 * whose label is already right" is a rule worth being able to test without a
 * forge on the other end.
 */

export interface LabelledIssue {
  /** `41`, as the forge names the issue in an address. */
  readonly ref: string;
  /** The labels it is wearing now, spelled as the forge spells them. */
  readonly labels: readonly string[];
  /** The list its card is on, or null when no card here owns it. */
  readonly listName: string | null;
}

export interface IssueLabelChange {
  readonly ref: string;
  /** The label to put on, or null when the right one is already there. */
  readonly add: string | null;
  /** The labels to take off, in the forge's own spelling. */
  readonly remove: readonly string[];
}

/**
 * Works out the changes, and leaves out the issues that need none.
 *
 * Only labels that are the name of a list are ever touched. A studio's own
 * labels — `bug`, `needs art`, `blocked on audio` — are not this product's to
 * remove, and an issue that has never been on the board keeps whatever it has.
 *
 * Matched without case, because `Backlog` and `backlog` are the same label to a
 * person and a duplicate to nobody but a comparison.
 */
export function planIssueLabels(
  issues: readonly LabelledIssue[],
  listNames: readonly string[],
): IssueLabelChange[] {
  const boardLabels = new Set(listNames.map((name) => name.toLowerCase()));

  return issues.flatMap((issue): IssueLabelChange[] => {
    if (issue.listName === null) {
      return [];
    }

    const wanted = issue.listName;
    const isWanted = (label: string): boolean => label.toLowerCase() === wanted.toLowerCase();

    const remove = issue.labels.filter(
      (label) => boardLabels.has(label.toLowerCase()) && !isWanted(label),
    );
    const add = issue.labels.some(isWanted) ? null : wanted;

    return add === null && remove.length === 0 ? [] : [{ ref: issue.ref, add, remove }];
  });
}
