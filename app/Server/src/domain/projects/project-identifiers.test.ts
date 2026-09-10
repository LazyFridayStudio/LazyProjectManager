import { projectSlugSchema } from '@lpm/shared';
import { describe, expect, it } from 'vitest';

import { deriveProjectSlug, disambiguateProjectSlug } from './project-identifiers.js';

const MAXIMUM_SLUG_LENGTH = 90;

describe('GIVEN a project address being derived from a name', () => {
  describe('WHEN the name is ordinary', () => {
    it('THEN it is a slug the detail query would accept', () => {
      const slug = deriveProjectSlug('Harbour Night');

      expect(slug).toBe('harbour-night');
      expect(projectSlugSchema.safeParse(slug).success).toBe(true);
    });
  });

  describe('WHEN the name has nothing a URL can carry', () => {
    it('THEN it still produces an addressable project', () => {
      expect(deriveProjectSlug('★★★')).toBe('project');
    });
  });

  describe('WHEN another project already holds that address', () => {
    it('THEN the code disambiguates it, because the code is already unique', () => {
      expect(disambiguateProjectSlug('kiln', 'KILN')).toBe('kiln-kiln');
    });

    it('THEN the result still fits the column, however long the name was', () => {
      const long = deriveProjectSlug('a'.repeat(200));
      const disambiguated = disambiguateProjectSlug(long, 'LONGCODE1');

      expect(disambiguated.length).toBeLessThanOrEqual(MAXIMUM_SLUG_LENGTH);
      expect(disambiguated.endsWith('-longcode1')).toBe(true);
    });
  });
});
