import { describe, expect, it } from 'vitest';

import {
  describeProjectSection,
  projectSectionSchema,
  projectUsesSection,
  switchableProjectSectionSchema,
  SWITCHABLE_PROJECT_SECTIONS,
} from './project-sections.js';

describe('GIVEN the sections a project has', () => {
  describe('WHEN asking which of them can be switched off', () => {
    it('THEN it is every section but the dashboard and the settings screen', () => {
      expect([...SWITCHABLE_PROJECT_SECTIONS]).toEqual([
        'assets',
        'board',
        'timeline',
        'builds',
        'budget',
        'docs',
      ]);
    });

    it('THEN the two that stay are refused rather than trusted not to be offered', () => {
      // Dashboard is where the launcher sends people, and Settings holds the
      // switch that would turn it back on.
      expect(switchableProjectSectionSchema.safeParse('dashboard').success).toBe(false);
      expect(switchableProjectSectionSchema.safeParse('settings').success).toBe(false);
    });

    it('THEN every switchable one is a real section, not a word of its own', () => {
      for (const section of SWITCHABLE_PROJECT_SECTIONS) {
        expect(projectSectionSchema.safeParse(section).success).toBe(true);
      }
    });
  });

  describe('WHEN asking whether a project draws a section', () => {
    it('THEN a project that has switched nothing off draws all of them', () => {
      expect(projectUsesSection('timeline', [])).toBe(true);
      expect(projectUsesSection('settings', [])).toBe(true);
    });

    it('THEN a section it has switched off is not drawn', () => {
      expect(projectUsesSection('timeline', ['timeline', 'budget'])).toBe(false);
      expect(projectUsesSection('budget', ['timeline', 'budget'])).toBe(false);
    });

    it('THEN the sections beside it are left alone', () => {
      expect(projectUsesSection('board', ['timeline', 'budget'])).toBe(true);
    });
  });

  describe('WHEN a section is named where somebody reads it', () => {
    it('THEN the two whose word is not their name say the word', () => {
      // The mapping that would rot if the sidebar and the settings screen each
      // kept their own copy of it.
      expect(describeProjectSection('board')).toBe('Tasks');
      expect(describeProjectSection('docs')).toBe('Design doc');
    });

    it('THEN every section has a word, so none draws as nothing', () => {
      for (const section of projectSectionSchema.options) {
        expect(describeProjectSection(section)).not.toBe('');
      }
    });
  });
});
