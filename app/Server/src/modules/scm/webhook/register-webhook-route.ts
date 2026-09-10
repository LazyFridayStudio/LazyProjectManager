import { createHash } from 'node:crypto';

import type { Database } from '@lpm/database';
import type { ScmProvider } from '@lpm/shared';
import type { FastifyInstance } from 'fastify';

import { decryptSecret } from '../../../security/secret-box.js';
import type { Environment } from '../../../server/environment.js';
import { isDeliveryAuthentic, readDeliveryId, readEventName } from './verify-delivery.js';
import { WEBHOOK_PATH } from './webhook-url.js';

/**
 * The largest delivery accepted.
 *
 * A push of a thousand commits is a large payload, and refusing it would lose
 * the commits. A megabyte is far above that and far below the point where
 * somebody is using this endpoint as free storage.
 */
const MAXIMUM_DELIVERY_BYTES = 1_048_576;

export interface WebhookRouteOptions {
  readonly database: Database;
  readonly environment: Environment;
}

interface ParsedDelivery {
  readonly raw: Buffer;
  readonly json: unknown;
}

/**
 * Where a forge tells us what happened.
 *
 * This is the only unauthenticated write in the server, because a repository has
 * no session to present. Everything it is given is attacker-controlled, so the
 * order here is deliberate: find the connection, verify the signature over the
 * exact bytes that arrived, and only then keep anything.
 *
 * It stores and answers. Working out what a delivery *means* is the worker's
 * job — a provider that waits for us to parse a push before it gets its 200 is a
 * provider that starts disabling the webhook.
 */
export function registerWebhookRoute(server: FastifyInstance, options: WebhookRouteOptions): void {
  // Registered as a plugin so the raw-body parser below is scoped to this one
  // route; every other route wants the parsed body and nothing else.
  void server.register((scope, _options, done) => {
    // The signature covers the bytes as sent, so they have to survive parsing.
    scope.addContentTypeParser<Buffer>(
      ['application/json', 'application/x-www-form-urlencoded'],
      { parseAs: 'buffer' },
      (_request, body, done) => {
        done(null, { raw: body, json: readJson(body) } satisfies ParsedDelivery);
      },
    );

    scope.post<{ Params: { connectionId: string }; Body: ParsedDelivery }>(
      `${WEBHOOK_PATH}/:connectionId`,
      { bodyLimit: MAXIMUM_DELIVERY_BYTES },
      async (request, reply) => {
        const connection = await findConnection(options.database, request.params.connectionId);

        if (connection === undefined) {
          // Also what a disconnected repository still posting looks like. A
          // connection id is a uuid, so nobody finds one by trying.
          return reply.status(404).send();
        }

        const secret = readSecret(connection.webhookSecretEnc, options.environment);
        const authentic =
          secret !== null &&
          isDeliveryAuthentic({
            provider: connection.provider,
            headers: request.headers,
            body: request.body.raw,
            secret,
          });

        if (!authentic) {
          request.log.warn(
            { connectionId: connection.id },
            'refused a delivery that was not signed with this connection secret',
          );

          return reply.status(401).send();
        }

        if (request.body.json === null) {
          return reply.status(400).send();
        }

        await recordDelivery({ options, connection, request });

        // Answered the moment it is safely stored. The worker reads it after.
        return reply.status(202).send();
      },
    );

    done();
  });
}

interface DeliveryToRecord {
  readonly options: WebhookRouteOptions;
  readonly connection: { id: string; provider: ScmProvider };
  readonly request: {
    readonly headers: Readonly<Record<string, string | string[] | undefined>>;
    readonly body: ParsedDelivery;
  };
}

/**
 * Keeps the delivery, exactly as it arrived.
 *
 * On conflict it does nothing rather than failing: a provider that got no answer
 * resends the same delivery, and landing it twice would double every commit on a
 * card. `last_event_at` still moves, because something did arrive.
 */
async function recordDelivery({ options, connection, request }: DeliveryToRecord): Promise<void> {
  await options.database.transaction().execute(async (transaction) => {
    await transaction
      .insertInto('scmEventRaw')
      .values({
        connectionId: connection.id,
        deliveryId: readDeliveryIdentity(connection.provider, request),
        eventName: readEventName(connection.provider, request.headers) ?? 'unknown',
        payload: JSON.stringify(request.body.json),
      })
      .onConflict((conflict) => conflict.columns(['connectionId', 'deliveryId']).doNothing())
      .execute();

    await transaction
      .updateTable('scmConnection')
      .set({ lastEventAt: new Date() })
      .where('id', '=', connection.id)
      .execute();
  });
}

/**
 * What makes this delivery this one.
 *
 * GitHub and Gitea send an id. GitLab does not, so the body itself stands in:
 * two identical payloads are a resend, and hashing them is the only way to say
 * so without the provider's help.
 */
function readDeliveryIdentity(provider: ScmProvider, request: DeliveryToRecord['request']): string {
  return (
    readDeliveryId(provider, request.headers) ??
    `sha256:${createHash('sha256').update(request.body.raw).digest('hex')}`
  );
}

function findConnection(database: Database, connectionId: string) {
  if (!isUuid(connectionId)) {
    // Postgres rejects a malformed uuid with an error rather than no rows, and
    // an error here would be a 500 for what is really a 404.
    return Promise.resolve(undefined);
  }

  return database
    .selectFrom('scmConnection')
    .select(['id', 'provider', 'webhookSecretEnc'])
    .where('id', '=', connectionId)
    .executeTakeFirst();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * A connection whose secret cannot be read is a connection nothing can be
 * verified against, which is refused rather than trusted.
 */
function readSecret(stored: string, environment: Environment): string | null {
  try {
    return decryptSecret(stored, environment.APP_SECRET);
  } catch {
    return null;
  }
}

/**
 * The delivery, however the forge chose to wrap it.
 *
 * GitHub offers two content types and defaults to the form-encoded one, which
 * sends `payload=<url-encoded json>` rather than the JSON itself. This route
 * declared it accepted both and could only read one, so a webhook left on the
 * default settings verified its signature and then came back 400 with an empty
 * body — correct, and impossible to act on.
 *
 * The signature is checked against the raw bytes either way, so reading the
 * form wrapper changes nothing about what was verified.
 */
function readJson(body: Buffer): unknown {
  const text = body.toString('utf8');

  return parseJson(text) ?? parseJson(readFormPayload(text));
}

/** `payload=%7B…%7D`, as a form-encoded delivery carries it. */
function readFormPayload(text: string): string | null {
  // Only that one field. A form body with anything else in it is not a shape
  // this has ever been sent, and guessing at one would be inventing a format.
  const payload = new URLSearchParams(text).get('payload');

  return payload === null || payload === '' ? null : payload;
}

function parseJson(text: string | null): unknown {
  if (text === null) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Refused later, after the signature has been checked — so a malformed body
    // is not a way to find out whether a connection id exists.
    return null;
  }
}
