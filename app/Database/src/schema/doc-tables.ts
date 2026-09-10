import type { ColumnType, Generated } from 'kysely';

type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

/** `numeric` arrives as a string and is written as a number, as everywhere. */
type Position = ColumnType<string, number, number>;

/**
 * One of a project's documents: a name and a field of markdown.
 *
 * Several per project, because the combat design, the audio bible and the
 * technical brief are separate documents that separate people own. A document's
 * own structure lives in the headings of its prose — there is nothing here to
 * keep in step with what somebody wrote.
 */
export interface ProjectDocTable {
  id: Generated<string>;
  accountId: string;
  projectId: string;
  title: Generated<string>;
  body: Generated<string>;
  position: Position;
  /**
   * Who last wrote it, or null once that person has left.
   *
   * The document outlives them; only the name attached to the last edit goes.
   */
  updatedBy: string | null;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}
