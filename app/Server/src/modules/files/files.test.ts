import { createTestDatabase, seedInstall, type TestDatabase } from '@lpm/database/testing';
import type { CardDetailView } from '@lpm/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createStubRedis } from '../../testing/index.js';
import { createServer } from '../../server/create-server.js';
import { readEnvironment } from '../../server/environment.js';
import { createStubObjectStore } from '../../storage/index.js';
import { hashPassword } from '../identity/password-hasher.js';

const PASSWORD = 'correct-horse-battery';
const OWNER_EMAIL = 'jake@northwind.test';

const testEnvironment = readEnvironment({
  NODE_ENV: 'test',
  BASE_URL: 'http://localhost:24571',
  DATABASE_URL: 'postgres://unused',
  REDIS_URL: 'redis://unused',
  S3_ENDPOINT: 'http://unused:9000',
  S3_BUCKET: 'lpm-test',
  S3_ACCESS_KEY: 'unused',
  S3_SECRET_KEY: 'unused',
});

let commandCounter = 0;

function nextCommandId(): string {
  commandCounter += 1;
  return `018f5555-0000-7000-8000-${String(commandCounter).padStart(12, '0')}`;
}

function readSessionCookie(cookies: readonly { name: string; value: string }[]): string {
  const cookie = cookies.find((candidate) => candidate.name === 'lpm_session');

  if (cookie === undefined) {
    throw new Error('Expected a session cookie to have been set.');
  }

  return cookie.value;
}

/**
 * The store is stubbed rather than real.
 *
 * These are tests about what the handlers do — that a confirm checks, that a
 * pending file stays hidden — and the one case that matters most is an upload
 * that never happened, which a real store cannot be asked for on demand. The
 * store client itself is a thin wrapper over the AWS SDK and is exercised by
 * the running app.
 */
describe('GIVEN a card that files can be put on', () => {
  let testDatabase: TestDatabase;
  let server: FastifyInstance;
  const storage = createStubObjectStore();
  let passwordHash: string;
  let ownerCookie: string;
  let projectId: string;
  let cardId: string;

  const redis = createStubRedis();

  beforeAll(async () => {
    testDatabase = await createTestDatabase();
    passwordHash = await hashPassword(PASSWORD);

    // Built once. Standing a Fastify instance up costs about a tenth of a
    // second, which over a suite is most of the time it takes to run — and
    // nothing in a server outlives a test that emptying the database and the
    // store does not already clear.
    server = await createServer({
      environment: testEnvironment,
      database: testDatabase.database,
      redis,
      storage,
    });
  });

  afterAll(async () => {
    await server.close();
    await testDatabase.close();
  });

  beforeEach(async () => {
    await testDatabase.truncateAllTables();
    redis.forgetEverything();

    // Emptied rather than replaced, so one test's uploads are never
    // another's without paying to build a server again.
    storage.forgetEverything();

    await seedInstall(testDatabase.database, {
      email: OWNER_EMAIL,
      passwordHash,
      displayName: 'Jake Winters',
    });

    ownerCookie = readSessionCookie(
      (
        await server.inject({
          method: 'POST',
          url: '/api/c/identity.signIn',
          payload: { commandId: nextCommandId(), email: OWNER_EMAIL, password: PASSWORD },
        })
      ).cookies,
    );

    projectId = (await command('projects.create', { name: 'Drowned Reach', code: 'DRCH' })).json<{
      id: string;
    }>().id;

    const list = await testDatabase.database
      .selectFrom('list')
      .select('id')
      .orderBy('position')
      .executeTakeFirstOrThrow();

    cardId = (
      await command('board.createCard', {
        projectId,
        listId: list.id,
        title: 'Harbour crane retopo',
        type: 'art',
      })
    ).json<{ id: string }>().id;
  });

  async function command(
    name: string,
    body: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<typeof server.inject>>> {
    return server.inject({
      method: 'POST',
      url: `/api/c/${name}`,
      payload: { commandId: nextCommandId(), ...body },
      cookies: { lpm_session: ownerCookie },
    });
  }

  async function requestUpload(
    filename = 'harbour-crane.psd',
    mime = 'image/vnd.adobe.photoshop',
  ): Promise<{ id: string; uploadUrl: string }> {
    const response = await command('files.requestUpload', {
      target: { kind: 'cardAttachment', cardId },
      filename,
      mime,
      bytes: 40_000_000,
    });

    return response.json<{ id: string; uploadUrl: string }>();
  }

  async function readCard(): Promise<CardDetailView> {
    const response = await server.inject({
      method: 'GET',
      url: `/api/q/board.cardDetail?cardId=${cardId}`,
      cookies: { lpm_session: ownerCookie },
    });

    return response.json<{ data: CardDetailView }>().data;
  }

  /** Pretends the browser finished the upload the server made room for. */
  async function pretendUploadArrived(bytes: number, mime: string): Promise<void> {
    const file = await testDatabase.database
      .selectFrom('file')
      .select('storageKey')
      .orderBy('createdAt', 'desc')
      .executeTakeFirstOrThrow();

    storage.put(file.storageKey, { bytes, mime });
  }

  describe('WHEN somewhere to upload is asked for', () => {
    it('THEN the address that comes back is the file’s own, on this server', async () => {
      const { id, uploadUrl } = await requestUpload();

      expect(id).toEqual(expect.any(String));
      // Where the bytes go, and where they will be read back from afterwards.
      // Nothing here names a host: there is one, the browser already reached
      // it, and an install that had to be told a second one shipped pointing at
      // a port nothing was listening on (#172).
      expect(uploadUrl).toBe(`/api/f/${id}`);
    });

    it('THEN the key is built from ids, not from what the file is called', async () => {
      await requestUpload('../../etc/passwd');

      const file = await testDatabase.database
        .selectFrom('file')
        .select('storageKey')
        .executeTakeFirstOrThrow();

      expect(file.storageKey).not.toContain('..');
      expect(file.storageKey.split('/')).toHaveLength(3);
    });

    it('THEN the file is pending, and the card does not show it yet', async () => {
      await requestUpload();

      const file = await testDatabase.database
        .selectFrom('file')
        .select(['state', 'bytes'])
        .executeTakeFirstOrThrow();

      expect(file.state).toBe('pending');
      expect(file.bytes).toBeNull();
      // A card must not list an attachment nobody can open.
      expect((await readCard()).attachments).toHaveLength(0);
    });

    it('THEN a file larger than this server accepts is refused before anything is sent', async () => {
      const response = await command('files.requestUpload', {
        target: { kind: 'cardAttachment', cardId },
        filename: 'everything.zip',
        mime: 'application/zip',
        bytes: 9 * 1024 * 1024 * 1024,
      });

      expect(response.statusCode).toBe(422);
    });

    it('THEN any media type is accepted, because a studio uploads all of them', async () => {
      for (const mime of ['image/png', 'application/x-blender', 'application/x-substance']) {
        const response = await command('files.requestUpload', {
          target: { kind: 'cardAttachment', cardId },
          filename: `asset.${mime.split('/')[1] ?? 'bin'}`,
          mime,
          bytes: 1_000,
        });

        expect(response.json()).toMatchObject({ ok: true });
      }
    });
  });

  describe('WHEN the upload is confirmed', () => {
    it('THEN the card shows it, with what the store actually received', async () => {
      const { id } = await requestUpload();
      await pretendUploadArrived(12_345, 'image/png');

      await command('files.confirmUpload', { fileId: id });

      const attachments = (await readCard()).attachments;

      expect(attachments).toHaveLength(1);
      // Not the 40,000,000 the request declared: the store is the authority.
      expect(attachments[0]).toMatchObject({
        filename: 'harbour-crane.psd',
        bytes: 12_345,
        mime: 'image/png',
      });
      expect(attachments[0]?.url).toBe(`/api/f/${String(attachments[0]?.fileId)}`);
    });

    it('THEN an upload that never arrived is refused', async () => {
      const { id } = await requestUpload();

      // Nothing was put in the store. A file the browser claims to have sent
      // and did not must not become an attachment.
      const response = await command('files.confirmUpload', { fileId: id });

      expect(response.statusCode).toBe(422);
      expect((await readCard()).attachments).toHaveLength(0);
    });

    it('THEN a file from another account is not found', async () => {
      const { id } = await requestUpload();
      const otherAccount = await testDatabase.database
        .insertInto('account')
        .values({ name: 'Other Studio', slug: 'other-studio' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await testDatabase.database
        .updateTable('file')
        .set({ accountId: otherAccount.id })
        .where('id', '=', id)
        .execute();

      expect((await command('files.confirmUpload', { fileId: id })).statusCode).toBe(404);
    });

    it('THEN an uploaded event carries no filename', async () => {
      const { id } = await requestUpload('publisher-contract-draft.pdf');
      await pretendUploadArrived(2_048, 'application/pdf');

      await command('files.confirmUpload', { fileId: id });

      const event = await testDatabase.database
        .selectFrom('domainEvent')
        .selectAll()
        .where('name', '=', 'files.uploaded')
        .executeTakeFirstOrThrow();

      // The outbox is read more widely than the card, and what a studio calls a
      // file can say what it is working on.
      expect(JSON.stringify(event.payload)).not.toContain('publisher');
    });
  });

  describe('WHEN a file is taken off a card', () => {
    it('THEN the attachment goes and the file stays', async () => {
      const { id } = await requestUpload();
      await pretendUploadArrived(1_000, 'image/png');
      await command('files.confirmUpload', { fileId: id });

      const attachmentId = (await readCard()).attachments[0]?.id;
      await command('files.detach', { attachmentId });

      const files = await testDatabase.database.selectFrom('file').selectAll().execute();

      expect((await readCard()).attachments).toHaveLength(0);
      // The same file can be on more than one card.
      expect(files).toHaveLength(1);
    });

    it('THEN an attachment that does not exist is not found', async () => {
      const response = await command('files.detach', {
        attachmentId: '018f0000-0000-7000-8000-00000000dead',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  /** The cache-control of a response, which is the header these tests are about. */
  function response(sent: Awaited<ReturnType<typeof server.inject>>): string {
    return sent.headers['cache-control'] ?? '';
  }

  /** A resized copy, as the worker would have left it. */
  const THUMBNAIL_KEY = 'account/file/original.png.thumb.webp';

  describe('WHEN a file is fetched at its stable address', () => {
    async function fetchFile(fileId: string, cookie: string | null = ownerCookie, search = '') {
      return server.inject({
        method: 'GET',
        url: `/api/f/${fileId}${search}`,
        ...(cookie === null ? {} : { cookies: { lpm_session: cookie } }),
      });
    }

    it('THEN it serves the bytes, rather than sending the browser to the store', async () => {
      const { id } = await requestUpload();
      await pretendUploadArrived(1_000, 'image/png');
      await command('files.confirmUpload', { fileId: id });

      const response = await fetchFile(id);

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['content-disposition']).toContain('harbour-crane.psd');
    });

    it('THEN the browser may keep it briefly, and only for whoever asked', async () => {
      const { id } = await requestUpload();
      await pretendUploadArrived(1_000, 'image/png');
      await command('files.confirmUpload', { fileId: id });

      // Every picture on every screen comes through here now, so something has
      // to say this. `private`, because the permission is checked per request
      // and a shared cache would be holding somebody else's answer.
      expect(response(await fetchFile(id))).toMatch(/^private, max-age=\d+$/u);
    });

    it('THEN an anonymous caller is refused', async () => {
      const { id } = await requestUpload();
      await pretendUploadArrived(1_000, 'image/png');
      await command('files.confirmUpload', { fileId: id });

      expect((await fetchFile(id, null)).statusCode).toBe(401);
    });

    it('THEN a file whose upload never finished is not found', async () => {
      // Pending, so nothing confirmed it. The address exists but the file does
      // not, and saying which would be saying more than it should.
      const { id } = await requestUpload();

      expect((await fetchFile(id)).statusCode).toBe(404);
    });

    it('THEN a file in another account is not found', async () => {
      const { id } = await requestUpload();
      await pretendUploadArrived(1_000, 'image/png');
      await command('files.confirmUpload', { fileId: id });

      const otherAccount = await testDatabase.database
        .insertInto('account')
        .values({ name: 'Other Studio', slug: 'other-studio' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await testDatabase.database
        .updateTable('file')
        .set({ accountId: otherAccount.id })
        .where('id', '=', id)
        .execute();

      expect((await fetchFile(id)).statusCode).toBe(404);
    });

    it('THEN it serves the thumbnail, and the original only when asked', async () => {
      const { id } = await requestUpload();
      await pretendUploadArrived(1_000, 'image/png');
      await command('files.confirmUpload', { fileId: id });

      const original = await testDatabase.database
        .selectFrom('file')
        .select('storageKey')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

      // Two objects with different contents, so what came back says which key
      // was read rather than only that something was.
      storage.putBytes(original.storageKey, Buffer.from('the original'), 'image/png');
      storage.putBytes(THUMBNAIL_KEY, Buffer.from('the thumbnail'), 'image/webp');

      await testDatabase.database
        .updateTable('file')
        .set({ thumbnailKey: THUMBNAIL_KEY })
        .where('id', '=', id)
        .execute();

      // An image in a description is being looked at, not worked on.
      expect((await fetchFile(id)).body).toBe('the thumbnail');
      expect((await fetchFile(id, ownerCookie, '?full')).body).toBe('the original');
    });
  });

  describe('WHEN the bytes of a file are sent', () => {
    interface SendAs {
      /** Null for a caller with no session at all. */
      readonly cookie?: string | null;
      /** What the request claims it is carrying, which the row overrules. */
      readonly contentType?: string;
    }

    async function sendBytes(fileId: string, body: string, sender: SendAs = {}) {
      const cookie = sender.cookie === undefined ? ownerCookie : sender.cookie;

      return server.inject({
        method: 'PUT',
        url: `/api/f/${fileId}`,
        payload: body,
        headers: { 'content-type': sender.contentType ?? 'image/png' },
        ...(cookie === null ? {} : { cookies: { lpm_session: cookie } }),
      });
    }

    it('THEN they land in the store, and the confirm finds them there', async () => {
      const { id } = await requestUpload();

      const sent = await sendBytes(id, 'the picture');
      const confirmed = await command('files.confirmUpload', { fileId: id });

      expect(sent.statusCode).toBe(204);
      expect(confirmed.statusCode).toBe(200);
      // The size the store reports, not the 40,000,000 the request declared.
      expect((await readCard()).attachments[0]).toMatchObject({ bytes: 'the picture'.length });
    });

    it('THEN what is stored is the type the request was granted for', async () => {
      const { id } = await requestUpload();

      // The header says one thing and the row says another. The row wins: the
      // first request is where a `.blend` on a reference sheet was refused, and
      // a store that believed this header would let the second request say
      // something the first would not have been allowed to.
      await sendBytes(id, 'the picture', { contentType: 'text/html' });
      await command('files.confirmUpload', { fileId: id });

      expect((await readCard()).attachments[0]?.mime).toBe('image/vnd.adobe.photoshop');
    });

    it('THEN an anonymous caller is refused', async () => {
      const { id } = await requestUpload();

      expect((await sendBytes(id, 'the picture', { cookie: null })).statusCode).toBe(401);
    });

    it('THEN somebody else’s upload is not theirs to finish', async () => {
      const { id } = await requestUpload();

      await testDatabase.database
        .updateTable('file')
        .set({ uploadedBy: null })
        .where('id', '=', id)
        .execute();

      expect((await sendBytes(id, 'the picture')).statusCode).toBe(403);
    });

    it('THEN a file that has already arrived is not waiting for anything', async () => {
      const { id } = await requestUpload();

      await sendBytes(id, 'the picture');
      await command('files.confirmUpload', { fileId: id });

      // Not pending any more. A second PUT would be a way to replace the bytes
      // of a file other things already point at.
      expect((await sendBytes(id, 'something else')).statusCode).toBe(404);
    });

    it('THEN a file in another account is not found', async () => {
      const { id } = await requestUpload();
      const otherAccount = await testDatabase.database
        .insertInto('account')
        .values({ name: 'Other Studio', slug: 'other-studio' })
        .returning('id')
        .executeTakeFirstOrThrow();

      await testDatabase.database
        .updateTable('file')
        .set({ accountId: otherAccount.id })
        .where('id', '=', id)
        .execute();

      expect((await sendBytes(id, 'the picture')).statusCode).toBe(404);
    });
  });

  describe('WHEN an agent uploads with its key rather than a session', () => {
    let agentKey: string;

    beforeEach(async () => {
      const agentUserId = (await command('identity.createAgent', { displayName: 'Claude' })).json<{
        id: string;
      }>().id;

      agentKey = (
        await command('identity.issueAgentToken', { userId: agentUserId, name: 'the laptop' })
      ).json<{ secret: string }>().secret;

      // What it may do. An agent is made at the bottom of the ladder holding no
      // groups at all, so putting a file on a card is something somebody has to
      // allow it on purpose.
      const groupId = (await command('permissions.createGroup', { name: 'Files' })).json<{
        id: string;
      }>().id;

      await command('permissions.setRule', { groupId, subject: 'file.upload', effect: 'allow' });
      await command('permissions.setUserGroup', { userId: agentUserId, groupId, held: true });

      // And where. A group says what it may do and being on the project says
      // where — an agent holding every group and on no project reaches nothing,
      // which reads as a card that does not exist rather than as a refusal.
      await command('projects.addMember', { projectId, userId: agentUserId });
    });

    /** A command sent the way something without a browser sends one. */
    async function asAgent(name: string, body: Record<string, unknown>) {
      return server.inject({
        method: 'POST',
        url: `/api/c/${name}`,
        headers: { authorization: `Bearer ${agentKey}` },
        payload: { commandId: nextCommandId(), ...body },
      });
    }

    /** Somewhere for the agent to put a file, asked for with its key. */
    async function askForSomewhere(): Promise<string> {
      const response = await asAgent('files.requestUpload', {
        target: { kind: 'cardAttachment', cardId },
        filename: 'crane-blockout.png',
        mime: 'image/png',
        bytes: 11,
      });

      return response.json<{ id: string }>().id;
    }

    async function sendBytesWithKey(fileId: string, key = agentKey) {
      return server.inject({
        method: 'PUT',
        url: `/api/f/${fileId}`,
        payload: 'the picture',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'image/png' },
      });
    }

    it('THEN the upload it was granted is one it can finish', async () => {
      const fileId = await askForSomewhere();

      const sent = await sendBytesWithKey(fileId);
      const confirmed = await asAgent('files.confirmUpload', { fileId });

      expect(sent.statusCode).toBe(204);
      expect(confirmed.statusCode).toBe(200);
      // On the card as anybody sees it, so what it left behind is not a pending
      // row nothing will ever finish.
      expect((await readCard()).attachments[0]).toMatchObject({
        filename: 'crane-blockout.png',
        bytes: 'the picture'.length,
      });
    });

    it('THEN it reads back what it put there, at the same address', async () => {
      const fileId = await askForSomewhere();
      await sendBytesWithKey(fileId);
      await asAgent('files.confirmUpload', { fileId });

      const read = await server.inject({
        method: 'GET',
        url: `/api/f/${fileId}`,
        headers: { authorization: `Bearer ${agentKey}` },
      });

      expect(read.statusCode).toBe(200);
      expect(read.body).toBe('the picture');
    });

    it('THEN a key that has been revoked cannot finish an upload it started', async () => {
      const fileId = await askForSomewhere();

      const token = await testDatabase.database
        .selectFrom('apiToken')
        .select('id')
        .executeTakeFirstOrThrow();

      await command('identity.revokeAgentToken', { tokenId: token.id });

      expect((await sendBytesWithKey(fileId)).statusCode).toBe(401);
    });

    it('THEN a key that is not one is refused, rather than falling back to a cookie beside it', async () => {
      // The precedence the whole API runs on. A header is set on purpose and a
      // cookie rides along on its own, so a request carrying a key is that
      // key's — and falling back would let a script running inside a signed-in
      // browser quietly act as whoever is signed in there.
      const { id } = await requestUpload();

      const sent = await server.inject({
        method: 'PUT',
        url: `/api/f/${id}`,
        payload: 'the picture',
        headers: { authorization: 'Bearer lpm_not-a-real-key', 'content-type': 'image/png' },
        cookies: { lpm_session: ownerCookie },
      });

      expect(sent.statusCode).toBe(401);
    });
  });

  describe('WHEN somebody sets their own picture', () => {
    /** The three steps, pointed at nobody: an avatar names no id. */
    async function setPicture(mime = 'image/png'): Promise<string> {
      const requested = await command('files.requestUpload', {
        target: { kind: 'userAvatar' },
        filename: 'me.png',
        mime,
        bytes: 11,
      });

      const { id, uploadUrl } = requested.json<{ id: string; uploadUrl: string }>();

      await server.inject({
        method: 'PUT',
        url: uploadUrl,
        payload: 'the picture',
        headers: { 'content-type': mime },
        cookies: { lpm_session: ownerCookie },
      });

      await command('files.confirmUpload', { fileId: id });

      return id;
    }

    it('THEN it hangs on them, and `identity.me` hands out its address', async () => {
      const fileId = await setPicture();

      const session = await server.inject({
        method: 'GET',
        url: '/api/q/identity.me',
        cookies: { lpm_session: ownerCookie },
      });

      expect(
        session.json<{ data: { user: { avatarUrl: string | null } } }>().data.user.avatarUrl,
      ).toBe(`/api/f/${fileId}`);
    });

    it('THEN choosing another replaces it, the way a project replaces its logo', async () => {
      const first = await setPicture();
      const second = await setPicture();

      const stored = await testDatabase.database
        .selectFrom('appUser')
        .select('avatarFileId')
        .where('email', '=', OWNER_EMAIL)
        .executeTakeFirstOrThrow();

      expect(second).not.toBe(first);
      expect(stored.avatarFileId).toBe(second);
    });

    it('THEN a file that is not a picture is refused', async () => {
      const response = await command('files.requestUpload', {
        target: { kind: 'userAvatar' },
        filename: 'notes.txt',
        mime: 'text/plain',
        bytes: 10,
      });

      expect(response.statusCode).toBe(422);
    });

    it('THEN a viewer may set one, because it answers to no permission', async () => {
      // `file.upload` needs `member`, and a viewer choosing their own face is
      // not somebody a permission should be refusing. Their picture is theirs
      // for the reason their name is.
      await command('identity.createUser', {
        email: 'viewer@northwind.test',
        displayName: 'Val Viewer',
        role: 'viewer',
        password: PASSWORD,
      });

      const theirCookie = readSessionCookie(
        (
          await server.inject({
            method: 'POST',
            url: '/api/c/identity.signIn',
            payload: {
              commandId: nextCommandId(),
              email: 'viewer@northwind.test',
              password: PASSWORD,
            },
          })
        ).cookies,
      );

      const requested = await server.inject({
        method: 'POST',
        url: '/api/c/files.requestUpload',
        payload: {
          commandId: nextCommandId(),
          target: { kind: 'userAvatar' },
          filename: 'val.png',
          mime: 'image/png',
          bytes: 11,
        },
        cookies: { lpm_session: theirCookie },
      });

      const { id, uploadUrl } = requested.json<{ id: string; uploadUrl: string }>();

      await server.inject({
        method: 'PUT',
        url: uploadUrl,
        payload: 'the picture',
        headers: { 'content-type': 'image/png' },
        cookies: { lpm_session: theirCookie },
      });

      const confirmed = await server.inject({
        method: 'POST',
        url: '/api/c/files.confirmUpload',
        payload: { commandId: nextCommandId(), fileId: id },
        cookies: { lpm_session: theirCookie },
      });

      expect(requested.statusCode).toBe(200);
      expect(confirmed.statusCode).toBe(200);
    });

    it('THEN a viewer still cannot put a file on a card', async () => {
      // The branch is on the kind of target, not on who is asking. Everything
      // that is not somebody's own picture still answers to `file.upload`.
      await command('identity.createUser', {
        email: 'other@northwind.test',
        displayName: 'Otto Viewer',
        role: 'viewer',
        password: PASSWORD,
      });

      const theirCookie = readSessionCookie(
        (
          await server.inject({
            method: 'POST',
            url: '/api/c/identity.signIn',
            payload: {
              commandId: nextCommandId(),
              email: 'other@northwind.test',
              password: PASSWORD,
            },
          })
        ).cookies,
      );

      const response = await server.inject({
        method: 'POST',
        url: '/api/c/files.requestUpload',
        payload: {
          commandId: nextCommandId(),
          target: { kind: 'cardAttachment', cardId },
          filename: 'sneaky.png',
          mime: 'image/png',
          bytes: 11,
        },
        cookies: { lpm_session: theirCookie },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('WHEN key art is uploaded for a project', () => {
    it('THEN the project points at it, with no card involved', async () => {
      const response = await command('files.requestUpload', {
        target: { kind: 'projectKeyArt', projectId },
        filename: 'key-art.png',
        mime: 'image/png',
        bytes: 2_000_000,
      });

      const project = await testDatabase.database
        .selectFrom('project')
        .select('keyArtFileId')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();

      expect(project.keyArtFileId).toBe(response.json<{ id: string }>().id);
      expect(
        await testDatabase.database.selectFrom('cardAttachment').selectAll().execute(),
      ).toEqual([]);
    });

    it('THEN uploading again replaces it and leaves the old file alone', async () => {
      await command('files.requestUpload', {
        target: { kind: 'projectKeyArt', projectId },
        filename: 'first.png',
        mime: 'image/png',
        bytes: 1_000,
      });

      const second = await command('files.requestUpload', {
        target: { kind: 'projectKeyArt', projectId },
        filename: 'second.png',
        mime: 'image/png',
        bytes: 1_000,
      });

      const project = await testDatabase.database
        .selectFrom('project')
        .select('keyArtFileId')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();
      const files = await testDatabase.database.selectFrom('file').selectAll().execute();

      expect(project.keyArtFileId).toBe(second.json<{ id: string }>().id);
      // Something else may still point at the one it replaced.
      expect(files).toHaveLength(2);
    });
  });

  describe('WHEN a logo is uploaded for a project', () => {
    it('THEN the project points at it, and its key art is untouched', async () => {
      const art = await command('files.requestUpload', {
        target: { kind: 'projectKeyArt', projectId },
        filename: 'key-art.png',
        mime: 'image/png',
        bytes: 1_000,
      });

      const logo = await command('files.requestUpload', {
        target: { kind: 'projectLogo', projectId },
        filename: 'logo.png',
        mime: 'image/png',
        bytes: 1_000,
      });

      const project = await testDatabase.database
        .selectFrom('project')
        .select(['keyArtFileId', 'logoFileId'])
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();

      // Two pictures with two jobs: one sells the game and one identifies it,
      // so choosing either must leave the other alone.
      expect(project.logoFileId).toBe(logo.json<{ id: string }>().id);
      expect(project.keyArtFileId).toBe(art.json<{ id: string }>().id);
    });

    it('THEN uploading again replaces it and leaves the old file alone', async () => {
      await command('files.requestUpload', {
        target: { kind: 'projectLogo', projectId },
        filename: 'first.png',
        mime: 'image/png',
        bytes: 1_000,
      });

      const second = await command('files.requestUpload', {
        target: { kind: 'projectLogo', projectId },
        filename: 'second.png',
        mime: 'image/png',
        bytes: 1_000,
      });

      const project = await testDatabase.database
        .selectFrom('project')
        .select('logoFileId')
        .where('id', '=', projectId)
        .executeTakeFirstOrThrow();

      expect(project.logoFileId).toBe(second.json<{ id: string }>().id);
      expect(await testDatabase.database.selectFrom('file').selectAll().execute()).toHaveLength(2);
    });
  });
});
