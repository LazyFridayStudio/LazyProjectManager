import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createAppAssertion,
  requestInstallationToken,
  GithubAppError,
  type FetchLike,
} from './github-app.js';

const NOW = new Date('2026-08-20T10:00:00.000Z');

/** A real key pair, so the signature is verified rather than described. */
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/** A `fetch` that answers once, and records what it was asked. */
function answering(response: Response): {
  fetch: FetchLike;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];

  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init });

      return Promise.resolve(response);
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('GIVEN a GitHub App', () => {
  const credentials = {
    appId: '412345',
    installationId: '98765',
    privateKey,
    apiBaseUrl: 'https://api.github.com',
  };

  describe('WHEN it says who it is', () => {
    it('THEN the assertion is signed by the key, so the forge can check it', () => {
      const [header, payload, signature] = createAppAssertion(credentials, NOW).split('.');

      const verified = createVerify('RSA-SHA256')
        .update(`${String(header)}.${String(payload)}`)
        .verify(createPublicKey(publicKey), Buffer.from(String(signature), 'base64url'));

      expect(verified).toBe(true);
      expect(decodeSegment(String(header))).toEqual({ alg: 'RS256', typ: 'JWT' });
    });

    it('THEN it is issued slightly in the past and expires within the ten minutes allowed', () => {
      const [, payload] = createAppAssertion(credentials, NOW).split('.');
      const claims = decodeSegment(String(payload)) as { iat: number; exp: number; iss: string };
      const seconds = Math.floor(NOW.getTime() / 1000);

      // Backdated, because a server whose clock is a few seconds ahead of the
      // forge's would otherwise present something issued in the future.
      expect(claims.iat).toBeLessThan(seconds);
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
      expect(claims.iss).toBe('412345');
    });

    it('THEN a key that will not sign says so in words somebody can act on', () => {
      expect(() => createAppAssertion({ appId: '1', privateKey: 'not a key at all' }, NOW)).toThrow(
        GithubAppError,
      );
    });
  });

  describe('WHEN it trades that for a token', () => {
    it('THEN it asks the installation endpoint, carrying the assertion', async () => {
      const answer = answering(
        jsonResponse({ token: 'ghs_secret', expires_at: '2026-08-20T11:00:00Z' }),
      );

      const token = await requestInstallationToken(credentials, NOW, answer.fetch);

      expect(token.token).toBe('ghs_secret');
      expect(answer.calls[0]?.url).toBe(
        'https://api.github.com/app/installations/98765/access_tokens',
      );
      // The assertion is what is presented, not the token it buys.
      const headers = answer.calls[0]?.init?.headers as Record<string, string> | undefined;

      expect(headers?.authorization).toMatch(/^Bearer ey/);
    });

    it('THEN a refusal is explained by what it was, not by its number alone', async () => {
      const unauthorised = answering(jsonResponse({}, 401));

      await expect(requestInstallationToken(credentials, NOW, unauthorised.fetch)).rejects.toThrow(
        /app id and private key/,
      );

      const missing = answering(jsonResponse({}, 404));

      await expect(requestInstallationToken(credentials, NOW, missing.fetch)).rejects.toThrow(
        /installation does not exist/,
      );
    });

    it('THEN a forge that cannot be reached is not reported as a refusal', async () => {
      // Different problems with different fixes: one is a wrong key, the other
      // is a firewall.
      const offline: FetchLike = () => Promise.reject(new Error('ECONNREFUSED'));

      await expect(requestInstallationToken(credentials, NOW, offline)).rejects.toThrow(
        /could not be reached/,
      );
    });
  });
});
