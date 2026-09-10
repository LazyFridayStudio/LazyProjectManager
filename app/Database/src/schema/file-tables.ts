import type { FileState } from '@lpm/shared';
import type { ColumnType, Generated } from 'kysely';

/**
 * Table types for files and what they are attached to.
 *
 * Bytes never come near Postgres: a row here is metadata for an object in the
 * store, and `storageKey` is where that object lives.
 */

type CreatedAt = ColumnType<Date, Date | undefined, never>;

/** As elsewhere: `bigint` arrives from `pg` as a string. */
type MinorUnits = ColumnType<string | null, number | null | undefined, number | null>;

export interface FileTable {
  id: Generated<string>;
  accountId: string;
  storageKey: string;
  filename: string;
  mime: string;
  /** Null until the upload is confirmed, because only then is it known. */
  bytes: MinorUnits;
  sha256: string | null;
  width: number | null;
  height: number | null;
  /** `pending` until the browser says the upload finished. */
  state: Generated<FileState>;
  /**
   * Null until a thumbnail is made, and for anything nothing can decode. Both
   * mean the same thing to a screen: draw the filename.
   */
  thumbnailKey: string | null;
  uploadedBy: string | null;
  createdAt: CreatedAt;
  storedAt: Date | null;
}

export interface CardAttachmentTable {
  id: Generated<string>;
  cardId: string;
  fileId: string;
  createdAt: CreatedAt;
}
