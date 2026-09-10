import { describe, expect, it } from 'vitest';

import { projectCodeSchema } from './project-vocabulary.js';
import { suggestProjectCode } from './suggest-project-code.js';

describe('GIVEN a project code being suggested from a name', () => {
  describe('WHEN the name has enough consonants', () => {
    it('THEN the vowels after the first letter are dropped', () => {
      expect(suggestProjectCode('Saltmarsh (prototype)')).toBe('SLTM');
      expect(suggestProjectCode('Drowned Reach')).toBe('DRWN');
      expect(suggestProjectCode('Harbour Night')).toBe('HRBR');
    });

    it('THEN punctuation and spacing are ignored', () => {
      expect(suggestProjectCode('  the: Kiln-Works!  ')).toBe('THKL');
    });

    it('THEN diacritics become their plain letter', () => {
      expect(suggestProjectCode('Ödland')).toBe('ODLN');
    });
  });

  describe('WHEN squeezing the name leaves too little to use', () => {
    it('THEN the unsqueezed name is suggested instead', () => {
      expect(suggestProjectCode('Kiln')).toBe('KILN');
      expect(suggestProjectCode('Iowa')).toBe('IOWA');
    });
  });

  describe('WHEN the name cannot produce a valid code', () => {
    it('THEN nothing is suggested, so the field asks to be filled in', () => {
      // A code has to start with a letter, so a name that starts with a digit
      // has no suggestion rather than one the server would reject.
      expect(suggestProjectCode('3D Realms')).toBe('');
      expect(suggestProjectCode('')).toBe('');
      expect(suggestProjectCode('★★★')).toBe('');
    });
  });

  describe('WHEN anything at all is suggested', () => {
    it('THEN it is something the create command would accept', () => {
      const names = ['Saltmarsh', 'Kiln', 'Drowned Reach', 'Ödland', 'Iowa', 'A B C D E F'];

      for (const name of names) {
        expect(projectCodeSchema.safeParse(suggestProjectCode(name)).success).toBe(true);
      }
    });
  });
});
