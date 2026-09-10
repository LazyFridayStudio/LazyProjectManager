import type { Database } from '@lpm/database';
import { createFailure, MAXIMUM_UPLOAD_BYTES } from '@lpm/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { findActorForRequest } from '../identity/index.js';
import { getHttpStatusForFailure } from '../../server/error-handler.js';
import type { ObjectStore } from '../../storage/index.js';

export interface FileRouteOptions {
  readonly database: Database;
  readonly storage: ObjectStore;
}

/**
 * How long a browser may reuse a file it has already fetched.
 *
 * `private`, so only the person who asked keeps a copy. Five minutes, because
 * the bytes behind one file id never change — a replaced logo is a new file
 * row — so the only thing a cache skips is the permission check, and this is
 * shorter than the ten-minute signature it replaces was.
 *
 * Something has to say this. Every image on every screen now comes through this
 * route rather than straight from the store, and a board of forty thumbnails
 * that refetched all of them on every render would be the cost of routing them
 * here.
 */
const CACHE_FOR_SECONDS = 300;

/**
 * The one address a file has, and the only door to the object store.
 *
 * `GET` reads it, `PUT` fills it. Nothing outside this process addresses the
 * store: the browser talks to the API, the API talks to MinIO, and an install
 * has one hostname to configure rather than two.
 *
 * It used to be a redirect to a presigned URL, and an upload used to be a `PUT`
 * straight at the store. That saved the bytes a trip through Node and cost an
 * address — one a browser could resolve, signed into every link, and impossible
 * to correct afterwards because a signature covers the host. The shipped
 * default named `localhost:9000`, which is nothing on the server and nothing on
 * the viewer's machine, so on a release install every upload failed and every
 * image was broken (#172).
 *
 * Registered as a plugin so the raw-body parser is scoped to these two routes.
 * Every other route in the server wants its body parsed.
 *
 * Both doors take either credential — an `Authorization: Bearer lpm_…` key or
 * the session cookie — through the one resolver the command and query routes
 * use. There was a second copy of that resolver here that read the cookie only,
 * so an agent could be granted somewhere to put a file and then refused when it
 * sent the bytes, leaving a pending row nothing would ever finish (#253).
 */
export function registerFileRoutes(server: FastifyInstance, options: FileRouteOptions): void {
  void server.register((scope, _options, done) => {
    // An upload arrives as whatever the file is — `image/png`, or the
    // `application/octet-stream` a browser falls back to. None of those have a
    // parser, and the body must not be read into memory anyway, so this hands
    // the request stream straight to the route.
    scope.addContentTypeParser('*', (_request, payload, parsed) => {
      parsed(null, payload);
    });

    registerRead(scope, options);
    registerWrite(scope, options);

    done();
  });
}

/**
 * Reads a file out, through this process.
 *
 * A stable address, which is what lets a description embed one: a link written
 * into a card body has to still work next year, and a signature lasts minutes.
 * The permission is checked on every request rather than baked into a URL, so a
 * link that leaves the app is worth nothing to whoever finds it.
 */
function registerRead(server: FastifyInstance, options: FileRouteOptions): void {
  server.get<{ Params: { fileId: string } }>('/api/f/:fileId', async (request, reply) => {
    const actor = await findActorForRequest(options.database, request);

    if (actor === null) {
      return reply.status(401).send();
    }

    const file = await findFile({
      database: options.database,
      fileId: request.params.fileId,
      accountId: actor.accountId,
      state: 'stored',
    });

    if (file === undefined) {
      // Also what a file in another account looks like, and one whose upload
      // never finished. Nobody learns a file exists by guessing at its id.
      return reply.status(404).send();
    }

    // The thumbnail when there is one: an image embedded in a description is
    // being looked at, not worked on, and the original can be forty megabytes.
    const key =
      request.query !== null && isAskingForOriginal(request.query)
        ? file.storageKey
        : (file.thumbnailKey ?? file.storageKey);

    const object = await options.storage.openStream(key);

    if (object === null) {
      // The row says stored and the bucket disagrees. Rare, and a 404 is the
      // honest answer: there is nothing here to send.
      return reply.status(404).send();
    }

    reply
      .header('cache-control', `private, max-age=${String(CACHE_FOR_SECONDS)}`)
      .header('content-type', object.mime)
      // What the browser calls it when it saves it. Without this, every file
      // downloads under its storage key, which is a pair of uuids.
      .header('content-disposition', `inline; filename="${file.filename.replace(/"/g, '')}"`);

    if (object.bytes > 0) {
      reply.header('content-length', object.bytes);
    }

    return reply.send(object.body);
  });
}

/**
 * Takes the bytes of a file somebody asked for somewhere to put.
 *
 * The row was made by `files.requestUpload`, which is where the permission to
 * put a file on that card or that asset was checked. What is left to check here
 * is that this is the person who asked, and that they have not already sent it.
 *
 * The content type is the one recorded on the row rather than the one on this
 * request: `requestUpload` refused a `.blend` on a reference sheet by looking at
 * that, and a store that took the header at face value would let the second
 * request say something the first would have been refused for.
 */
function registerWrite(server: FastifyInstance, options: FileRouteOptions): void {
  server.put<{ Params: { fileId: string } }>('/api/f/:fileId', async (request, reply) => {
    const actor = await findActorForRequest(options.database, request);

    if (actor === null) {
      return refuse(reply, 'UNAUTHENTICATED', 'Sign in and try that again.');
    }

    const file = await findFile({
      database: options.database,
      fileId: request.params.fileId,
      accountId: actor.accountId,
      state: 'pending',
    });

    if (file === undefined) {
      return refuse(reply, 'NOT_FOUND', 'There is nowhere waiting for that file.');
    }

    if (file.uploadedBy !== actor.userId) {
      return refuse(reply, 'FORBIDDEN', 'That upload was somebody else’s to finish.');
    }

    const bytes = readContentLength(request.headers['content-length']);

    if (bytes === null) {
      return refuse(reply, 'VALIDATION_FAILED', 'That upload did not say how large it is.');
    }

    if (bytes > MAXIMUM_UPLOAD_BYTES) {
      return refuse(reply, 'INVARIANT_VIOLATED', 'That file is larger than this server accepts.');
    }

    await options.storage.writeStream({
      storageKey: file.storageKey,
      body: request.raw,
      mime: file.mime,
      bytes,
    });

    // Nothing is said about the file here. `files.confirmUpload` reads the size
    // and type back out of the store and flips the row to stored, because what
    // arrived is a better authority than what claimed to be sending.
    return reply.status(204).send();
  });
}

interface StoredFile {
  readonly storageKey: string;
  readonly thumbnailKey: string | null;
  readonly filename: string;
  readonly mime: string;
  /** Null for a file this server made rather than one somebody sent. */
  readonly uploadedBy: string | null;
}

interface FileLookup {
  readonly database: Database;
  readonly fileId: string;
  readonly accountId: string;
  /** `stored` for a file being read, `pending` for one still on its way in. */
  readonly state: 'pending' | 'stored';
}

/** One file of the caller's account, in the state the route needs it to be in. */
async function findFile(lookup: FileLookup): Promise<StoredFile | undefined> {
  return lookup.database
    .selectFrom('file')
    .select(['storageKey', 'thumbnailKey', 'filename', 'mime', 'uploadedBy'])
    .where('id', '=', lookup.fileId)
    .where('accountId', '=', lookup.accountId)
    .where('state', '=', lookup.state)
    .executeTakeFirst();
}

/**
 * Answers in the shape every other refusal on this API takes.
 *
 * These routes are outside the command envelope — one carries bytes and the
 * other answers with them — but a client should not have to read two kinds of
 * failure depending on which door it knocked on.
 */
function refuse(
  reply: FastifyReply,
  code: Parameters<typeof createFailure>[0],
  message: string,
): FastifyReply {
  const failure = createFailure(code, message);

  return reply.status(getHttpStatusForFailure(code)).send(failure);
}

/** The length of the body, or null when it is missing or not a number. */
function readContentLength(header: string | undefined): number | null {
  if (header === undefined) {
    return null;
  }

  const bytes = Number(header);

  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

/** `?full` asks for what was uploaded rather than what is drawn. */
function isAskingForOriginal(query: unknown): boolean {
  return typeof query === 'object' && query !== null && 'full' in query;
}
