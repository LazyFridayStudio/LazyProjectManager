/**
 * How a category's heading is addressed as a droppable.
 *
 * Its own module because both drags need it and they already need each other:
 * the tile drag decides what a heading means when a tile is let go over it, and
 * the heading drag decides what one means when a heading is. Left in either
 * file, the two would import each other in a circle.
 */

/**
 * A heading, as a thing that can be picked up and dropped on.
 *
 * Prefixed rather than the category's own id, because a category is already a
 * droppable under that id — the open space a tile is dropped into to land on
 * the end. Two droppables cannot share one id, and the two are genuinely
 * different places: "the tiles of this category" and "this heading, in the
 * order the headings read in".
 */
const HEADING = 'category-heading:';

export function headingIdOf(categoryId: string): string {
  return `${HEADING}${categoryId}`;
}

/** The category a heading id names, or null for anything that is not one. */
export function categoryIdOfHeading(id: string): string | null {
  return id.startsWith(HEADING) ? id.slice(HEADING.length) : null;
}

/**
 * A heading's own row, as a thing to measure a drop against.
 *
 * The heading is dragged by the section around it, which is as tall as
 * everything the category holds — fine for "which heading is the pointer
 * nearest", useless for "where in that heading's row". Nesting one category
 * inside another turns on that second question, so the row is a droppable of
 * its own: nothing is dropped *on* it, it is there to be measured.
 */
const ROW = 'category-row:';

export function rowIdOf(categoryId: string): string {
  return `${ROW}${categoryId}`;
}

/** The category a row id names, or null for anything that is not one. */
export function categoryIdOfRow(id: string): string | null {
  return id.startsWith(ROW) ? id.slice(ROW.length) : null;
}
