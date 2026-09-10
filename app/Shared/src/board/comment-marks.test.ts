import { describe, expect, it } from 'vitest';

import {
  readComment,
  readCommentAsText,
  readMentionedUserIds,
  writeCommentMark,
} from './comment-marks.js';

const MIRA = '018f0000-0000-7000-8000-000000000001';
const CRANE = '018f0000-0000-7000-8000-000000000002';

describe('GIVEN a mark being written into a comment', () => {
  describe('WHEN somebody is chosen from the picker', () => {
    it('THEN it carries who they are as well as what they are called', () => {
      expect(writeCommentMark({ kind: 'user', id: MIRA, label: 'Mira Kaur' })).toBe(
        `@[Mira Kaur](user:${MIRA})`,
      );
    });

    it('THEN a card is written with a hash and an asset the same way', () => {
      expect(writeCommentMark({ kind: 'card', id: CRANE, label: 'SLTM-TASK-1' })).toBe(
        `#[SLTM-TASK-1](card:${CRANE})`,
      );
      expect(writeCommentMark({ kind: 'asset', id: CRANE, label: 'Ruined watchtower' })).toBe(
        `#[Ruined watchtower](asset:${CRANE})`,
      );
    });

    it('THEN a bracket in a name cannot end the mark early', () => {
      // Not a real name, and the one place a stray bracket would turn a mark
      // into something that reads as one and is not.
      const written = writeCommentMark({ kind: 'user', id: MIRA, label: 'Mira ]( Kaur' });

      expect(written).toBe(`@[Mira Kaur](user:${MIRA})`);
      expect(readComment(written)).toHaveLength(1);
    });
  });
});

describe('GIVEN a comment being read back', () => {
  describe('WHEN it holds a mark', () => {
    it('THEN the words around it survive exactly as written', () => {
      const body = `The deck in #[SLTM-TASK-1](card:${CRANE}) is wrong, @[Mira Kaur](user:${MIRA})`;

      expect(readComment(body)).toEqual([
        { kind: 'text', text: 'The deck in ' },
        { kind: 'mark', markKind: 'card', id: CRANE, label: 'SLTM-TASK-1' },
        { kind: 'text', text: ' is wrong, ' },
        { kind: 'mark', markKind: 'user', id: MIRA, label: 'Mira Kaur' },
      ]);
    });

    it('THEN a comment that is only a mark is only a mark', () => {
      expect(readComment(`@[Mira Kaur](user:${MIRA})`)).toEqual([
        { kind: 'mark', markKind: 'user', id: MIRA, label: 'Mira Kaur' },
      ]);
    });
  });

  describe('WHEN somebody typed a sigil and did not finish', () => {
    it('THEN it is the text they typed, and nothing else', () => {
      // The common case by far: most `@` in most comments are an email address
      // or a half-typed thought, and both have to come back as themselves.
      const body = 'ask @mira about it, and see issue #4 — jake@northwind.studio';

      expect(readComment(body)).toEqual([{ kind: 'text', text: body }]);
      expect(readMentionedUserIds(body)).toEqual([]);
    });

    it('THEN an ordinary markdown link is not a mention', () => {
      // The sigil is what separates the two. Without it this is a link somebody
      // pasted, and reading it as a mention would notify a stranger.
      const body = `[Mira Kaur](user:${MIRA})`;

      expect(readComment(body)).toEqual([{ kind: 'text', text: body }]);
    });

    it('THEN a hash naming a person is left alone, and so is an at naming a card', () => {
      // Somebody typing rather than something chosen: the picker only ever
      // writes the sigil that belongs to the kind.
      const body = `#[Mira Kaur](user:${MIRA}) and @[SLTM-TASK-1](card:${CRANE})`;

      expect(readComment(body)).toEqual([{ kind: 'text', text: body }]);
    });
  });

  describe('WHEN it is being counted rather than drawn', () => {
    it('THEN everybody named comes back once, in the order they were named', () => {
      const body = `@[Mira Kaur](user:${MIRA}) and again @[Mira Kaur](user:${MIRA})`;

      expect(readMentionedUserIds(body)).toEqual([MIRA]);
    });

    it('THEN a card is not a person, however it is written', () => {
      expect(readMentionedUserIds(`#[SLTM-TASK-1](card:${CRANE})`)).toEqual([]);
    });
  });

  describe('WHEN it is shown somewhere that has not been taught what a mark is', () => {
    it('THEN it reads as the words it stands for', () => {
      const body = `@[Mira Kaur](user:${MIRA}) the deck in #[SLTM-TASK-1](card:${CRANE}) is wrong`;

      expect(readCommentAsText(body)).toBe('@Mira Kaur the deck in #SLTM-TASK-1 is wrong');
    });
  });
});
