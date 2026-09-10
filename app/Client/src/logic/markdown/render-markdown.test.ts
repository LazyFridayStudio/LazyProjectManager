// @vitest-environment jsdom
//
// The only file here that needs a DOM. `DOMPurify` decides what survives by
// parsing the HTML, and the placement rewriting reads the images back out of
// it — neither can be done to a string. The rest of the suite stays on `node`,
// which is faster and is what the server code wants.

import { describe, expect, it } from 'vitest';

import { readPlacement, renderMarkdown, writeImageMarkdown } from './render-markdown.js';

describe('GIVEN an image being written into a description', () => {
  describe('WHEN it is placed', () => {
    it('THEN alignment and scale go in the title, which is standard markdown', () => {
      expect(
        writeImageMarkdown('Harbour crane', '/api/f/018f', { alignment: 'left', scale: 0.5 }),
      ).toBe('![Harbour crane](/api/f/018f "left 0.5")');
    });

    it('THEN it defaults to centred and full width', () => {
      expect(writeImageMarkdown('Crane', '/api/f/018f')).toBe('![Crane](/api/f/018f "center 1")');
    });
  });

  describe('WHEN a title is read back', () => {
    it('THEN it round-trips', () => {
      expect(readPlacement('right 0.25')).toEqual({ alignment: 'right', scale: 0.25 });
    });

    it('THEN anything unreadable falls back rather than being refused', () => {
      // Somebody hand-editing the markdown, or a file written by another editor.
      for (const title of ['', 'middle 2', 'nonsense', null, undefined]) {
        expect(readPlacement(title)).toEqual({ alignment: 'center', scale: 1 });
      }
    });

    it('THEN a scale outside 0 to 1 is brought back inside it', () => {
      // 0 would be invisible and above 1 would spill out of the box it is in.
      expect(readPlacement('center 5').scale).toBe(1);
      expect(readPlacement('center 0').scale).toBe(1);
      expect(readPlacement('center -1').scale).toBe(1);
    });
  });
});

describe('GIVEN a description being rendered', () => {
  describe('WHEN it is ordinary markdown', () => {
    it('THEN it becomes the HTML it describes', () => {
      const html = renderMarkdown('# Harbour\n\nA **crane** and a [link](https://example.test).');

      expect(html).toContain('<h1');
      expect(html).toContain('<strong>crane</strong>');
      expect(html).toContain('href="https://example.test"');
    });
  });

  describe('WHEN it carries an image with a placement', () => {
    it('THEN the placement becomes how the image is drawn', () => {
      const html = renderMarkdown('![Crane](/api/f/018f "left 0.5")');

      expect(html).toContain('width: 50%');
      // Left-aligned, so nothing pushes it in from the left.
      expect(html).toMatch(/margin-left:\s*0/);
      // The title has done its job and would otherwise show as a tooltip.
      expect(html).not.toContain('title=');
    });

    it('THEN a centred image is centred', () => {
      const html = renderMarkdown('![Crane](/api/f/018f "center 1")');

      expect(html).toMatch(/margin-left:\s*auto/);
      expect(html).toMatch(/margin-right:\s*auto/);
    });

    it('THEN an image with no placement still renders, at full width', () => {
      // What another markdown editor would have written.
      const html = renderMarkdown('![Crane](/api/f/018f)');

      expect(html).toContain('<img');
      expect(html).toContain('width: 100%');
    });
  });

  describe('WHEN somebody has written something dangerous in it', () => {
    it('THEN it does not survive', () => {
      // A description is text one person writes and others read, which is the
      // shape of every stored scripting bug there has ever been.
      const html = renderMarkdown(
        '<script>alert(1)</script><img src=x onerror="alert(2)"><a href="javascript:alert(3)">go</a>',
      );

      expect(html).not.toContain('<script');
      expect(html).not.toContain('onerror');
      expect(html).not.toContain('javascript:');
    });

    it('THEN an event handler smuggled through an image title cannot escape', () => {
      const html = renderMarkdown('![x](/api/f/018f "center 1\\" onload=alert(1)")');

      expect(html).not.toContain('onload');
    });

    it('THEN an iframe and a form are both removed', () => {
      const html = renderMarkdown(
        '<iframe src="https://evil.test"></iframe><form action="/steal"><input name="password"></form>',
      );

      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<form');
    });
  });
});
