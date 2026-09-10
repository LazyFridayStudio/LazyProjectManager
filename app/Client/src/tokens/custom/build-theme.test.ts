import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { ThemeColors } from '@lpm/shared';

import { buildThemeProperties, isReadable } from './build-theme.js';

const PALETTE: ThemeColors = {
  background: '#101418',
  text: '#e9edf1',
  accent: '#eda363',
  secondary: '#63aeeb',
  tertiary: '#63eba3',
  danger: '#eb7d73',
  warning: '#f0de8a',
  success: '#63eba3',
  scheme: 'dark',
};

function nameOf(declarations: readonly (readonly [string, string])[]): Set<string> {
  return new Set(declarations.map(([name]) => name));
}

describe('GIVEN a theme somebody wrote', () => {
  describe('WHEN it is turned into custom properties', () => {
    it('THEN it sets every property a shipped theme sets', () => {
      /*
       * The test that stops this drifting.
       *
       * A property added to the dark theme and not here is a screen that reads
       * a token nothing declared — which is invisible until somebody on a
       * custom theme opens the one screen that uses it.
       */
      const source = readFileSync(
        fileURLToPath(new URL('../render-css-custom-properties.ts', import.meta.url)),
        'utf8',
      );
      const block = source.slice(
        source.indexOf('function darkThemeDeclarations'),
        source.indexOf('function lightThemeDeclarations'),
      );
      const shipped = [...block.matchAll(/\['(--[a-z0-9-]+|color-scheme)'/gu)].map(
        (match) => match[1] ?? '',
      );

      const built = nameOf(buildThemeProperties(PALETTE));

      expect(shipped.length).toBeGreaterThan(20);
      for (const property of shipped) {
        expect(built).toContain(property);
      }
    });

    it('THEN the eight it was given come back unchanged', () => {
      const built = new Map(buildThemeProperties(PALETTE));

      expect(built.get('--color-bg')).toBe(PALETTE.background);
      expect(built.get('--color-text')).toBe(PALETTE.text);
      expect(built.get('--color-accent')).toBe(PALETTE.accent);
      expect(built.get('--color-danger')).toBe(PALETTE.danger);
      expect(built.get('color-scheme')).toBe('dark');
    });

    it('THEN the stepped-back tones are left to follow the text colour', () => {
      // They are declared once as percentages of `--color-text`, so a theme
      // that sets the text redefines all of them for free. Setting them here
      // would be a second answer that could disagree.
      const built = nameOf(buildThemeProperties(PALETTE));

      expect(built).not.toContain('--color-text-muted');
      expect(built).not.toContain('--color-hairline');
    });

    it('THEN panel and surface are steps off the ground, not colours of their own', () => {
      const built = new Map(buildThemeProperties(PALETTE));

      expect(built.get('--color-panel')).not.toBe(PALETTE.background);
      expect(built.get('--color-surface')).not.toBe(built.get('--color-panel'));
    });

    it('THEN a light theme tints its lists less, because a bright ground shows hue', () => {
      const dark = new Map(buildThemeProperties(PALETTE));
      const light = new Map(buildThemeProperties({ ...PALETTE, scheme: 'light' }));

      expect(dark.get('--list-tint')).toBe('6%');
      expect(light.get('--list-tint')).toBe('3%');
      expect(light.get('color-scheme')).toBe('light');
    });

    it('THEN a light theme keeps less of a category colour, because it has to be read', () => {
      // A swatch only has to be seen; a name has to be read, and the palette is
      // pitched for the first. Olive straight on a light ground is 1.16:1.
      const dark = new Map(buildThemeProperties(PALETTE));
      const light = new Map(buildThemeProperties({ ...PALETTE, scheme: 'light' }));

      expect(dark.get('--category-ink')).toBe('70%');
      expect(light.get('--category-ink')).toBe('35%');
    });

    it('THEN what is written on the accent is worked out, not fixed', () => {
      const pale = new Map(buildThemeProperties({ ...PALETTE, accent: '#fbe3cc' }));
      const deep = new Map(buildThemeProperties({ ...PALETTE, accent: '#4a3520' }));

      expect(pale.get('--color-text-on-accent')).toBe('#242424');
      expect(deep.get('--color-text-on-accent')).toBe('#ffffff');
    });
  });

  describe('WHEN a palette cannot be read', () => {
    it('THEN text on its own ground is what decides it', () => {
      expect(isReadable({ background: '#101418', text: '#e9edf1' })).toBe(true);
      // Somebody will do this, and the panel has to say so before it is saved.
      expect(isReadable({ background: '#101418', text: '#141a20' })).toBe(false);
      expect(isReadable({ background: '#ffffff', text: '#f4f4f4' })).toBe(false);
    });
  });
});
