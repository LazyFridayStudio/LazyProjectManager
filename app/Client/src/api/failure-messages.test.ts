import { describe, expect, it } from 'vitest';

import { ApiFailureError, ApiUnreachableError } from './api-failure-error.js';
import { describeFailure, isRefusal, readFieldProblems } from './failure-messages.js';

describe('GIVEN a command the server refused because a rule said no', () => {
  const refused = new ApiFailureError({
    ok: false,
    code: 'WIP_LIMIT_REACHED',
    message: 'In progress is limited to 8 cards. Finish something before starting more.',
  });

  describe('WHEN the corner is deciding how to say it', () => {
    it('THEN it is a refusal, which is said as a warning rather than as a fault', () => {
      expect(isRefusal(refused)).toBe(true);
    });

    it('THEN the words are the ones the server chose', () => {
      expect(describeFailure(refused)).toBe(
        'In progress is limited to 8 cards. Finish something before starting more.',
      );
    });
  });
});

describe('GIVEN a command that failed because something went wrong', () => {
  describe('WHEN the server reported a fault', () => {
    it('THEN it is not a refusal', () => {
      const failed = new ApiFailureError({
        ok: false,
        code: 'INTERNAL_ERROR',
        message: 'Something broke.',
      });

      expect(isRefusal(failed)).toBe(false);
    });
  });

  describe('WHEN the server could not be reached at all', () => {
    const unreachable = new ApiUnreachableError('http://localhost:24571', new Error('offline'));

    it('THEN it is not a refusal', () => {
      expect(isRefusal(unreachable)).toBe(false);
    });

    it('THEN it is described as something the person can act on', () => {
      expect(describeFailure(unreachable)).toBe(
        'Could not reach the server. Check your connection and try again.',
      );
    });

    it('THEN it names no fields, so a form shows one message instead', () => {
      expect(readFieldProblems(unreachable)).toEqual({});
    });
  });
});
