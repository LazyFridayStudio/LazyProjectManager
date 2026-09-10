import { describe, expect, it } from 'vitest';

import { describeFileSize, describeReleaseKind, readFileSize } from './release-vocabulary.js';

describe('GIVEN the size of something somebody can download', () => {
  describe('WHEN it is written out', () => {
    it('THEN it reads in the unit a person would say', () => {
      expect(describeFileSize(820 * 1024 ** 2)).toBe('820 MB');
      expect(describeFileSize(Math.round(4.2 * 1024 ** 3))).toBe('4.2 GB');
    });

    it('THEN bytes are whole and everything larger keeps one decimal', () => {
      // `840 KB` and `4.2 GB` are how these are said; `4.19 GB` is nobody's
      // idea of clearer, and `0.5 B` is not a thing.
      expect(describeFileSize(999)).toBe('999 B');
      expect(describeFileSize(1536)).toBe('1.5 KB');
    });

    it('THEN a file nobody measured says so rather than saying nought', () => {
      // Nought bytes is a real and different thing from an unknown size.
      expect(describeFileSize(null)).toBe('—');
      expect(describeFileSize(0)).toBe('0 B');
    });
  });

  describe('WHEN somebody types one in', () => {
    it('THEN it is read the way it was written', () => {
      expect(readFileSize('4.2 GB')).toBe(Math.round(4.2 * 1024 ** 3));
      expect(readFileSize('820MB')).toBe(820 * 1024 ** 2);
      expect(readFileSize('  12 kb  ')).toBe(12 * 1024);
    });

    it('THEN a bare number is bytes, which is what typing 1024 means', () => {
      expect(readFileSize('1024')).toBe(1024);
    });

    it('THEN what it cannot read is nobody measuring rather than an error', () => {
      // The size of a download is worth less than the row saying it exists.
      expect(readFileSize('')).toBeNull();
      expect(readFileSize('big')).toBeNull();
      expect(readFileSize('4.2 parsecs')).toBeNull();
    });

    it('THEN a size read and written again is the size that was typed', () => {
      const bytes = readFileSize('4.2 GB');

      expect(describeFileSize(bytes)).toBe('4.2 GB');
    });
  });
});

describe('GIVEN a release to put a word against', () => {
  describe('WHEN it is finished and for everybody', () => {
    it('THEN it is the latest', () => {
      expect(describeReleaseKind({ isDraft: false, isPrerelease: false })).toBe('latest');
    });
  });

  describe('WHEN it is not for players yet', () => {
    it('THEN it is a pre-release', () => {
      expect(describeReleaseKind({ isDraft: false, isPrerelease: true })).toBe('pre-release');
    });
  });

  describe('WHEN it is not finished at all', () => {
    it('THEN draft wins, whatever else it was going to be', () => {
      // Something unfinished is unfinished whatever it was going to be, and it
      // is the more important of the two to see.
      expect(describeReleaseKind({ isDraft: true, isPrerelease: false })).toBe('draft');
      expect(describeReleaseKind({ isDraft: true, isPrerelease: true })).toBe('draft');
    });
  });
});
