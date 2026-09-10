import { describe, expect, it } from 'vitest';

import { buildStorageKey } from './storage-key.js';

const ACCOUNT = '018f0000-0000-7000-8000-0000000000a1';
const FILE = '018f0000-0000-7000-8000-0000000000f1';

describe('GIVEN a file being given a place in the store', () => {
  describe('WHEN it has an ordinary name', () => {
    it('THEN the key is the account, the file and the name', () => {
      expect(buildStorageKey(ACCOUNT, FILE, 'concept.psd')).toBe(`${ACCOUNT}/${FILE}/concept.psd`);
    });

    it('THEN the account comes first, so one studio can be listed or lifted out', () => {
      expect(buildStorageKey(ACCOUNT, FILE, 'a.png').startsWith(`${ACCOUNT}/`)).toBe(true);
    });
  });

  describe('WHEN two people upload the same filename', () => {
    it('THEN the keys differ, because the file id is in them', () => {
      const first = buildStorageKey(ACCOUNT, FILE, 'concept.psd');
      const second = buildStorageKey(
        ACCOUNT,
        '018f0000-0000-7000-8000-0000000000f2',
        'concept.psd',
      );

      expect(first).not.toBe(second);
    });
  });

  describe('WHEN the name is trying to get out of its folder', () => {
    it('THEN it cannot', () => {
      // A key built from something a person typed is a key somebody can climb
      // out of. This is the test that says they cannot.
      for (const name of ['../../etc/passwd', String.raw`..\..\windows`, '/absolute/path']) {
        const key = buildStorageKey(ACCOUNT, FILE, name);

        expect(key.startsWith(`${ACCOUNT}/${FILE}/`)).toBe(true);
        expect(key).not.toContain('..');
        expect(key.split('/')).toHaveLength(3);
      }
    });
  });

  describe('WHEN the name is unusual', () => {
    it('THEN something usable survives', () => {
      expect(buildStorageKey(ACCOUNT, FILE, 'Ötzi final (v2).blend')).toBe(
        `${ACCOUNT}/${FILE}/Otzi-final-v2-.blend`,
      );
      expect(buildStorageKey(ACCOUNT, FILE, '★★★')).toBe(`${ACCOUNT}/${FILE}/file`);
      expect(buildStorageKey(ACCOUNT, FILE, '.hidden')).toBe(`${ACCOUNT}/${FILE}/hidden`);
    });

    it('THEN a very long name is cut rather than refused', () => {
      const key = buildStorageKey(ACCOUNT, FILE, `${'a'.repeat(400)}.substance`);

      expect(key.length).toBeLessThan(200);
      expect(key.startsWith(`${ACCOUNT}/${FILE}/`)).toBe(true);
    });
  });
});
