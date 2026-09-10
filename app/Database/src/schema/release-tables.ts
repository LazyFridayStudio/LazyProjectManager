import type { ColumnType, Generated } from 'kysely';

type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;

/** `date` reads back as `YYYY-MM-DD`; the OID 1082 parser is overridden for it. */
type CalendarDate = ColumnType<string, string, string>;

/** `numeric` arrives as a string and is written as a number, as everywhere. */
type Position = ColumnType<string, number, number>;

/** `bigint` arrives from `pg` as a string, because it does not fit a number. */
type BigCount = ColumnType<string | null, number | null, number | null>;

/**
 * Something the project has shipped.
 *
 * `author` is text rather than a user id: what publishes a release is usually
 * `build-bot`, which is not somebody with an account here.
 *
 * The notes are one field of markdown for the reason a design document is —
 * a changelog is written top to bottom, and the headings people put in it are
 * their own rather than three this product picked.
 */
export interface ProjectReleaseTable {
  id: Generated<string>;
  accountId: string;
  projectId: string;
  /**
   * `hand`, or the provider that filled it in.
   *
   * What somebody typed is never overwritten by a sync; what a forge owns is
   * refreshed from it. Telling them apart is the whole of that rule.
   */
  source: Generated<string>;
  /** The forge's own id, so a tag renamed upstream moves rather than doubles. */
  externalId: string | null;
  tag: string;
  name: string;
  publishedOn: CalendarDate;
  author: string;
  commitSha: string | null;
  isPrerelease: Generated<boolean>;
  isDraft: Generated<boolean>;
  notes: Generated<string>;
  runLabel: string | null;
  url: string | null;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}

/**
 * A file somebody can download from a release.
 *
 * Bytes rather than the `4.2 GB` the design draws: a display string cannot be
 * compared or summed, and the screen can always write it back out that way.
 */
export interface ReleaseAssetTable {
  id: Generated<string>;
  accountId: string;
  releaseId: string;
  name: string;
  sizeBytes: BigCount;
  downloadCount: Generated<number>;
  /** Where the file is. Null for one nobody has said, which draws no button. */
  downloadUrl: string | null;
  position: Position;
  createdAt: CreatedAt;
}
