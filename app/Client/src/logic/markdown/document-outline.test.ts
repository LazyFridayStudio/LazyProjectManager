// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { readOutline, slugify } from './document-outline.js';

describe('GIVEN a rendered document', () => {
  describe('WHEN its headings are read', () => {
    it('THEN each one becomes an entry with the level it was written at', () => {
      const { outline } = readOutline('<h1>Pillars</h1><h2>Tone</h2><h3>Detail</h3>');

      expect(outline).toEqual([
        { level: 1, text: 'Pillars', slug: 'pillars' },
        { level: 2, text: 'Tone', slug: 'tone' },
        { level: 3, text: 'Detail', slug: 'detail' },
      ]);
    });

    it('THEN the heading carries the anchor the entry points at', () => {
      const { html } = readOutline('<h2>The fantasy</h2>');

      expect(html).toContain('id="the-fantasy"');
    });

    it('THEN what a heading was marked up with is not part of its name', () => {
      // An outline built by re-reading the markdown would have to guess what
      // the renderer made of this, and scroll to nothing the day it guessed
      // differently.
      const { outline } = readOutline('<h2>The <strong>last</strong> lamplighter</h2>');

      expect(outline[0]).toMatchObject({ text: 'The last lamplighter' });
    });

    it('THEN anything deeper than three levels is not something to navigate by', () => {
      const { outline } = readOutline('<h3>Kept</h3><h4>Left out</h4><h5>Left out</h5>');

      expect(outline.map((entry) => entry.text)).toEqual(['Kept']);
    });

    it('THEN prose between the headings changes nothing', () => {
      const { outline } = readOutline('<h1>One</h1><p>Words.</p><h2>Two</h2><ul><li>A</li></ul>');

      expect(outline.map((entry) => entry.text)).toEqual(['One', 'Two']);
    });

    it('THEN a document with no headings has no contents list', () => {
      expect(readOutline('<p>Just prose.</p>').outline).toEqual([]);
    });
  });

  describe('WHEN the same heading is used twice', () => {
    it('THEN the second one is still reachable', () => {
      // Two sections called Overview is normal in a long document, and an
      // anchor that quietly pointed at the first would scroll to the wrong one.
      const { outline, html } = readOutline('<h2>Overview</h2><h2>Overview</h2>');

      expect(outline.map((entry) => entry.slug)).toEqual(['overview', 'overview-2']);
      expect(html).toContain('id="overview-2"');
    });
  });

  describe('WHEN a heading is empty', () => {
    it('THEN it is not offered as somewhere to go', () => {
      expect(readOutline('<h2></h2><h2>Real</h2>').outline).toHaveLength(1);
    });
  });
});

describe('GIVEN a heading to make an anchor from', () => {
  describe('WHEN it is turned into a slug', () => {
    it('THEN it is lower case with words joined by hyphens', () => {
      expect(slugify('The Fantasy')).toBe('the-fantasy');
    });

    it('THEN punctuation does not end up in a URL', () => {
      expect(slugify('What it is not — really!')).toBe('what-it-is-not-really');
    });

    it('THEN letters outside English survive, because studios are not all English', () => {
      expect(slugify('Système de lampe')).toBe('système-de-lampe');
    });

    it('THEN a heading of nothing but punctuation still has somewhere to point', () => {
      expect(slugify('!!!')).toBe('section');
    });
  });
});
