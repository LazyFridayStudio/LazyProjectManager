import { describe, expect, it } from 'vitest';

import {
  countWords,
  markdownFileName,
  nextDocumentName,
  titleFromMarkdown,
} from './doc-vocabulary.js';

/** Written this way because an escaped one keeps being eaten in transit. */
const NEWLINE = String.fromCharCode(10);

describe('GIVEN a document to name or measure', () => {
  describe('WHEN it is counted', () => {
    it('THEN an empty one is nought rather than one', () => {
      expect(countWords('')).toBe(0);
      expect(countWords('   ')).toBe(0);
    });

    it('THEN markdown punctuation counts as part of the word it is stuck to', () => {
      expect(countWords('You are the **last lamplighter**.')).toBe(5);
    });
  });

  describe('WHEN a file is imported', () => {
    it('THEN its own first heading names it, over whatever the file was called', () => {
      const body = ['# Drowned Reach', '', 'A game about lamps.'].join(NEWLINE);

      expect(titleFromMarkdown('gdd_FINAL_v3.md', body)).toBe('Drowned Reach');
    });

    it('THEN a heading further down is not mistaken for the first one', () => {
      const body = ['Some preamble.', '', '# The real title', '', '# A later one'].join(NEWLINE);

      expect(titleFromMarkdown('notes.md', body)).toBe('The real title');
    });

    it('THEN a deeper heading is not a title', () => {
      // `##` is a heading inside a document, not the name of it.
      const body = ['## Tone', '', 'Damp, and quietly hopeful.'].join(NEWLINE);

      expect(titleFromMarkdown('audio-bible.md', body)).toBe('audio bible');
    });

    it('THEN the file name stands in, read as the words it was standing for', () => {
      expect(titleFromMarkdown('audio_bible-second_pass.md', 'No headings here.')).toBe(
        'audio bible second pass',
      );
    });

    it('THEN a closed heading loses its closing hashes', () => {
      // Some writers close a heading; the hashes are syntax, not the name.
      expect(titleFromMarkdown('x.md', '# Pillars #')).toBe('Pillars');
    });

    it('THEN a title too long for a tab is cut rather than refused', () => {
      const long = 'a'.repeat(200);

      expect(titleFromMarkdown('x.md', `# ${long}`)).toHaveLength(80);
    });

    it('THEN a file with nothing to take a name from still gets one', () => {
      // A refused import is worse than a document called something dull.
      expect(titleFromMarkdown('.md', '')).toBe('Imported document');
    });
  });

  describe('WHEN one is added from the row of tabs', () => {
    it('THEN the first is bare, because nobody is counting them yet', () => {
      expect(nextDocumentName([])).toBe('New doc');
      expect(nextDocumentName(['Game design'])).toBe('New doc');
    });

    it('THEN the next one is numbered off it', () => {
      expect(nextDocumentName(['New doc'])).toBe('New doc 2');
      expect(nextDocumentName(['New doc', 'New doc 2'])).toBe('New doc 3');
    });

    it('THEN a gap left by a rename is filled rather than skipped', () => {
      // Worked out from the names that are there, not from how many there are:
      // skipping to `New doc 3` here would be counting documents nobody has.
      expect(nextDocumentName(['Game design', 'New doc 2'])).toBe('New doc');
    });

    it('THEN a name that differs only in case is still taken', () => {
      // Two tabs reading `New doc` and `new doc` are two nobody can tell apart.
      expect(nextDocumentName(['new DOC'])).toBe('New doc 2');
    });
  });

  describe('WHEN a document is exported', () => {
    it('THEN it is named after itself, in characters every filesystem takes', () => {
      expect(markdownFileName('Audio bible — second pass')).toBe('audio-bible-second-pass.md');
    });

    it('THEN nothing separates the name from its extension but the dot', () => {
      expect(markdownFileName('Pillars!!!')).toBe('pillars.md');
    });

    it('THEN a name this reduction cannot spell still produces a file', () => {
      // Rather than `.md`, which is a hidden file with no name on it.
      expect(markdownFileName('設計')).toBe('document.md');
    });
  });
});
