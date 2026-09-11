import { MAXIMUM_ASSET_CATEGORY_NAME_LENGTH } from '@lpm/shared';

/** A category, by what it is called. */
export interface NamedCategory {
  readonly id: string;
  readonly name: string;
}

export interface CategoriesComingUp {
  /** The category being deleted, which a clashing child is named after. */
  readonly leaving: string;
  /** What was inside it, in the order it was in. */
  readonly children: readonly NamedCategory[];
  /**
   * Every name already used where they land, not counting the one leaving.
   *
   * Its name is free the moment it goes, which is why a `Props` inside `Props`
   * comes up as `Props` rather than as something else.
   */
  readonly takenWhereTheyLand: ReadonlySet<string>;
}

/**
 * What each category coming up out of a deleted one is called where it lands.
 *
 * Its own name, wherever that is free. Where it is not — an empty `Mobs` inside
 * `Props`, coming up beside a `Mobs` already there — it is named after the
 * category it came out of, `Mobs (from Props)`, rather than the delete being
 * refused. Deleting a heading is refiling, and a refusal that arrives after
 * somebody has confirmed is a rename they have to go and make before they may
 * drop a heading they no longer want. The bin puts the old name back.
 *
 * The ones keeping their names are settled first. Otherwise a `Mobs` renamed
 * `Mobs (from Props)` could take the name of a sibling already called that,
 * coming up alongside it.
 */
export function nameWhereTheyLand({
  leaving,
  children,
  takenWhereTheyLand,
}: CategoriesComingUp): NamedCategory[] {
  const taken = new Set(takenWhereTheyLand);
  const clashing = children.filter((child) => taken.has(child.name));

  for (const child of children) {
    taken.add(child.name);
  }

  const renamed = new Map<string, string>();

  for (const child of clashing) {
    const free = firstFreeName({ name: child.name, leaving, taken });

    taken.add(free);
    renamed.set(child.id, free);
  }

  return children.map((child) => ({ id: child.id, name: renamed.get(child.id) ?? child.name }));
}

/** `Mobs (from Props)`, then `Mobs (from Props) 2`, and on until one is free. */
function firstFreeName({
  name,
  leaving,
  taken,
}: {
  readonly name: string;
  readonly leaving: string;
  readonly taken: ReadonlySet<string>;
}): string {
  const words = `${name} (from ${leaving})`;

  for (let attempt = 1; ; attempt += 1) {
    const candidate = withinTheLongestName(words, attempt === 1 ? '' : ` ${String(attempt)}`);

    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

const ELLIPSIS = '…';

/**
 * Cut to the longest name a category may have, keeping the number on the end.
 *
 * Two long names and the words between them can come to more than a category
 * name may hold, and a name the edit dialog refuses is one somebody cannot save
 * the category under. The number is what makes the name free, so it survives
 * the cut and the words before it give way.
 */
function withinTheLongestName(words: string, number: string): string {
  if (words.length + number.length <= MAXIMUM_ASSET_CATEGORY_NAME_LENGTH) {
    return `${words}${number}`;
  }

  const room = MAXIMUM_ASSET_CATEGORY_NAME_LENGTH - number.length - ELLIPSIS.length;

  return `${words.slice(0, room).trimEnd()}${ELLIPSIS}${number}`;
}
