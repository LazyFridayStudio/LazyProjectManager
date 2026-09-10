import type { AssetCategory } from '@lpm/shared';

import { flattenCategories } from '../../logic/assets/category-tree.js';
import { descendantsOf } from '../../logic/assets/category-tree.js';
import { Select, type SelectOption } from '../ui/index.js';

/**
 * Where a category sits: at the top of the library, or inside another one.
 *
 * A picker rather than a drag, because this is the move that changes what a
 * thing *is* rather than what order things are read in — and because the target
 * is often a heading somewhere else on a long screen, which is a scroll with the
 * mouse button held down.
 *
 * The depth is drawn into the label with spaces rather than as a styled tree: a
 * native `select` renders its options itself, and a listbox built to be prettier
 * is the control that stops working on a phone.
 */
export function CategoryParent({
  categories,
  value,
  exclude,
  problem,
  onChange,
}: {
  readonly categories: readonly AssetCategory[];
  readonly value: string | null;
  /**
   * The category being edited, if any.
   *
   * It cannot be put inside itself or inside anything under it — that is a
   * branch that leaves the library — so neither is offered. The server refuses
   * it as well; this is what stops somebody being able to ask.
   */
  readonly exclude?: AssetCategory | undefined;
  readonly problem?: string | undefined;
  readonly onChange: (parentId: string | null) => void;
}): React.JSX.Element {
  const options = parentOptions(categories, exclude);

  return (
    <Select
      label="Inside"
      options={options}
      value={value ?? TOP_LEVEL}
      problem={problem}
      onChange={(event) => {
        onChange(event.target.value === TOP_LEVEL ? null : event.target.value);
      }}
    />
  );
}

/**
 * The value standing for the top of the library.
 *
 * A `select` deals in strings, and an empty one reads as "nothing chosen" —
 * which is a different thing from choosing the top.
 */
const TOP_LEVEL = 'top';

function parentOptions(
  categories: readonly AssetCategory[],
  exclude: AssetCategory | undefined,
): SelectOption[] {
  const forbidden =
    exclude === undefined
      ? new Set<string>()
      : new Set([exclude.id, ...descendantsOf(exclude).map((each) => each.id)]);

  return [
    { value: TOP_LEVEL, label: 'The top of the library' },
    ...flattenCategories(categories)
      .filter((found) => !forbidden.has(found.category.id))
      .map((found) => ({
        value: found.category.id,
        label: `${'\u00a0\u00a0'.repeat(found.depth)}${found.category.name}`,
      })),
  ];
}
