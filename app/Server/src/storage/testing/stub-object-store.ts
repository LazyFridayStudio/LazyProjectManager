import { Readable } from 'node:stream';

import type { ObjectStore, StoredObject, StreamedUpload } from '../object-store.js';

export interface StubObjectStore {
  /** Keys written through `writeStream`, in the order they arrived. */
  readonly uploads: string[];
  /** Pretends the browser finished an upload, so a confirm has something to find. */
  put: (storageKey: string, object: StoredObject) => void;
  /** Pretends real bytes arrived, for anything that reads them back. */
  putBytes: (storageKey: string, body: Buffer, mime: string) => void;
  /**
   * Drops everything, so one store can serve a whole suite.
   *
   * Named for what it does rather than `reset`, which reads like a method the
   * real store would have. It has no such thing: you cannot empty a bucket by
   * asking politely.
   */
  forgetEverything: () => void;
}

/**
 * An object store that remembers what it was told, with nothing behind it.
 *
 * Most tests need a store to exist rather than to work: a board test should not
 * fail because MinIO is not running. Tests about uploading use the real one.
 */
export function createStubObjectStore(): ObjectStore & StubObjectStore {
  const objects = new Map<string, StoredObject>();
  const contents = new Map<string, Buffer>();
  const uploads: string[] = [];

  const stub = {
    uploads,
    ensureBucket: () => Promise.resolve(),
    openStream: (storageKey: string) => {
      const object = objects.get(storageKey);

      if (object === undefined) {
        return Promise.resolve(null);
      }

      return Promise.resolve({
        ...object,
        body: Readable.from(contents.get(storageKey) ?? Buffer.alloc(0)),
      });
    },
    writeStream: async (upload: StreamedUpload) => {
      uploads.push(upload.storageKey);

      const chunks: Buffer[] = [];

      for await (const chunk of upload.body) {
        chunks.push(Buffer.from(chunk as Buffer));
      }

      const stored = Buffer.concat(chunks);

      contents.set(upload.storageKey, stored);
      objects.set(upload.storageKey, { bytes: stored.byteLength, mime: upload.mime });
    },
    read: (storageKey: string) => Promise.resolve(contents.get(storageKey) ?? null),
    write: (storageKey: string, body: Buffer, mime: string) => {
      contents.set(storageKey, body);
      objects.set(storageKey, { bytes: body.byteLength, mime });
      return Promise.resolve();
    },
    describe: (storageKey: string) => Promise.resolve(objects.get(storageKey) ?? null),
    put: (storageKey: string, object: StoredObject) => {
      objects.set(storageKey, object);
    },
    putBytes: (storageKey: string, body: Buffer, mime: string) => {
      contents.set(storageKey, body);
      objects.set(storageKey, { bytes: body.byteLength, mime });
    },
    forgetEverything: () => {
      objects.clear();
      contents.clear();
      uploads.length = 0;
    },
  };

  return stub as unknown as ObjectStore & StubObjectStore;
}
