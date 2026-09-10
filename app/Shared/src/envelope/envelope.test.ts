import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  commandResultSchema,
  createCommandSuccess,
  defineCommand,
  getCommandRequestSchema,
} from './command-definition.js';
import { failureCodes, isFailureCode } from './failure-codes.js';
import { createFailure, failureSchema, isFailure } from './failure.js';
import {
  createQueryResultSchema,
  createQuerySuccess,
  createQuerySuccessSchema,
  defineQuery,
} from './query-definition.js';

const VALID_COMMAND_ID = '018f0000-0000-7000-8000-000000000001';

describe('GIVEN a failure code', () => {
  describe('WHEN it is one of the closed set', () => {
    it('THEN it is recognised', () => {
      expect(isFailureCode('NOT_FOUND')).toBe(true);
      expect(isFailureCode('VALIDATION_FAILED')).toBe(true);
    });

    it('THEN every declared code recognises itself', () => {
      expect(failureCodes.filter((code) => !isFailureCode(code))).toEqual([]);
    });
  });

  describe('WHEN it was invented at a call site', () => {
    it('THEN it is rejected, which is the point of the closed union', () => {
      expect(isFailureCode('SOMETHING_ELSE')).toBe(false);
    });
  });
});

describe('GIVEN a failure envelope', () => {
  describe('WHEN it is built without field detail', () => {
    it('THEN it carries the code and message, and omits fields entirely', () => {
      const failure = createFailure('NOT_FOUND', 'No such card.');

      expect(failure).toEqual({ ok: false, code: 'NOT_FOUND', message: 'No such card.' });
      expect('fields' in failure).toBe(false);
      expect(failureSchema.safeParse(failure).success).toBe(true);
    });
  });

  describe('WHEN it is built with field detail', () => {
    it('THEN the fields survive, so a form can highlight the control', () => {
      const failure = createFailure('VALIDATION_FAILED', 'Check the form.', { email: 'Required.' });

      expect(failure.fields).toEqual({ email: 'Required.' });
    });
  });

  describe('WHEN a result is inspected', () => {
    it('THEN isFailure distinguishes it from a success', () => {
      expect(isFailure({ ok: false })).toBe(true);
      expect(isFailure({ ok: true })).toBe(false);
    });
  });
});

describe('GIVEN a command definition', () => {
  const moveCard = defineCommand('board.moveCard', z.object({ cardId: z.string().uuid() }));

  describe('WHEN its name is read', () => {
    it('THEN it is the URL segment the route serves', () => {
      expect(moveCard.name).toBe('board.moveCard');
    });
  });

  describe('WHEN a request body carries the envelope and the input', () => {
    it('THEN it parses', () => {
      const parsed = getCommandRequestSchema(moveCard).safeParse({
        commandId: VALID_COMMAND_ID,
        cardId: VALID_COMMAND_ID,
      });

      expect(parsed.success).toBe(true);
    });
  });

  describe('WHEN a request body omits the commandId', () => {
    it('THEN it is rejected, because retries would stop being idempotent', () => {
      const parsed = getCommandRequestSchema(moveCard).safeParse({ cardId: VALID_COMMAND_ID });

      expect(parsed.success).toBe(false);
    });
  });

  describe('WHEN a success is built', () => {
    it('THEN an id is included only when there is one to report', () => {
      expect(createCommandSuccess(VALID_COMMAND_ID)).toEqual({ ok: true, id: VALID_COMMAND_ID });
      expect(createCommandSuccess()).toEqual({ ok: true });
    });

    it('THEN it matches the wire result schema', () => {
      expect(commandResultSchema.safeParse(createCommandSuccess()).success).toBe(true);
      expect(
        commandResultSchema.safeParse(createFailure('CONFLICT', 'Already there.')).success,
      ).toBe(true);
    });
  });
});

describe('GIVEN a query definition', () => {
  const boardView = defineQuery(
    'board.view',
    z.object({ projectId: z.string() }),
    z.object({ listCount: z.number() }),
  );

  describe('WHEN a success envelope is built', () => {
    it('THEN it carries the etag alongside the view', () => {
      const success = createQuerySuccess('"abc"', { listCount: 3 });

      expect(success).toEqual({ ok: true, etag: '"abc"', data: { listCount: 3 } });
    });

    it('THEN it satisfies the schema derived from the view', () => {
      const schema = createQuerySuccessSchema(boardView.viewSchema);

      expect(schema.safeParse(createQuerySuccess('"abc"', { listCount: 3 })).success).toBe(true);
    });

    it('THEN a view of the wrong shape is rejected at the boundary', () => {
      const schema = createQuerySuccessSchema(boardView.viewSchema);

      expect(
        schema.safeParse({ ok: true, etag: '"abc"', data: { listCount: 'three' } }).success,
      ).toBe(false);
    });
  });

  describe('WHEN the full result schema is built', () => {
    it('THEN it accepts either a success or a failure', () => {
      const schema = createQueryResultSchema(boardView.viewSchema);

      expect(schema.safeParse(createQuerySuccess('"e"', { listCount: 0 })).success).toBe(true);
      expect(schema.safeParse(createFailure('FORBIDDEN', 'No.')).success).toBe(true);
      expect(schema.safeParse({ ok: true }).success).toBe(false);
    });
  });
});
