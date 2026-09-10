import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { isDeliveryAuthentic, readDeliveryId, readEventName } from './verify-delivery.js';

const SECRET = 'wh_2f8c1a44d0e34b1fa9c7e5b06d1a83f4';
const BODY = Buffer.from(JSON.stringify({ ref: 'refs/heads/main' }), 'utf8');

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('GIVEN a delivery arriving at the webhook endpoint', () => {
  describe('WHEN it is signed with the secret the project was connected with', () => {
    it('THEN it is accepted', () => {
      const headers = { 'x-hub-signature-256': sign(BODY, SECRET) };

      expect(isDeliveryAuthentic({ provider: 'github', headers, body: BODY, secret: SECRET })).toBe(
        true,
      );
    });

    it('THEN Gitea is verified the same way, because it signs the same way', () => {
      const headers = { 'x-hub-signature-256': sign(BODY, SECRET) };

      expect(isDeliveryAuthentic({ provider: 'gitea', headers, body: BODY, secret: SECRET })).toBe(
        true,
      );
    });

    it('THEN GitLab is accepted on the token it sends instead of a signature', () => {
      const headers = { 'x-gitlab-token': SECRET };

      expect(isDeliveryAuthentic({ provider: 'gitlab', headers, body: BODY, secret: SECRET })).toBe(
        true,
      );
    });
  });

  describe('WHEN it is not', () => {
    it('THEN a signature made with another secret is refused', () => {
      const headers = { 'x-hub-signature-256': sign(BODY, 'some other secret') };

      expect(isDeliveryAuthentic({ provider: 'github', headers, body: BODY, secret: SECRET })).toBe(
        false,
      );
    });

    it('THEN a body edited after signing is refused', () => {
      const headers = { 'x-hub-signature-256': sign(BODY, SECRET) };
      const edited = Buffer.from(JSON.stringify({ ref: 'refs/heads/theirs' }), 'utf8');

      expect(
        isDeliveryAuthentic({ provider: 'github', headers, body: edited, secret: SECRET }),
      ).toBe(false);
    });

    it('THEN no signature at all is refused', () => {
      expect(
        isDeliveryAuthentic({ provider: 'github', headers: {}, body: BODY, secret: SECRET }),
      ).toBe(false);
    });

    it('THEN a signature sent twice is refused rather than one of them being picked', () => {
      const headers = { 'x-hub-signature-256': [sign(BODY, SECRET), sign(BODY, 'other')] };

      expect(isDeliveryAuthentic({ provider: 'github', headers, body: BODY, secret: SECRET })).toBe(
        false,
      );
    });

    it('THEN a signature of the right shape but the wrong length is refused', () => {
      const headers = { 'x-hub-signature-256': 'sha256=abc' };

      expect(isDeliveryAuthentic({ provider: 'github', headers, body: BODY, secret: SECRET })).toBe(
        false,
      );
    });
  });

  describe('WHEN the delivery says what it is', () => {
    it('THEN the event name is read from the header its provider uses', () => {
      expect(readEventName('github', { 'x-github-event': 'push' })).toBe('push');
      expect(readEventName('gitlab', { 'x-gitlab-event': 'Push Hook' })).toBe('Push Hook');
      expect(readEventName('github', {})).toBeNull();
    });

    it('THEN the delivery id is read from the header its provider uses', () => {
      expect(readDeliveryId('github', { 'x-github-delivery': 'd-1' })).toBe('d-1');
      expect(readDeliveryId('gitlab', { 'x-gitlab-event-uuid': 'u-1' })).toBe('u-1');
      expect(readDeliveryId('github', {})).toBeNull();
    });
  });
});
