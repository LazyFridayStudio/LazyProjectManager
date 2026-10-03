// @vitest-environment jsdom
//
// A DOM for the element styles the helper writes and reads back. The animation
// library itself is replaced: what is under test is what this app decides —
// where a tween starts, when a thing is allowed to leave, what is left on the
// element afterwards — not whether the library can count to 200 milliseconds.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { motionDurationMs } from '../../tokens/motion-tokens.js';

interface Started {
  readonly element: HTMLElement;
  readonly keyframes: Record<string, readonly [string, string]>;
  readonly options: { readonly duration: number };
  readonly stop: ReturnType<typeof vi.fn>;
  readonly finish: () => Promise<void>;
}

const started: Started[] = [];

vi.mock('motion/mini', () => ({
  animate: (
    element: HTMLElement,
    keyframes: Started['keyframes'],
    options: Started['options'],
  ): unknown => {
    let finish = (): void => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });

    const stop = vi.fn(() => {
      // As the library does: what is drawn at that moment is written onto the
      // element, so the next tween can set off from it.
      element.style.opacity = '0.4';
    });

    started.push({
      element,
      keyframes,
      options,
      stop,
      finish: async () => {
        finish();
        await finished;
      },
    });

    return { stop, finished };
  },
}));

const { arrive, leave } = await import('./motion.js');

function asksForLessMotion(asks: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: asks && query === '(prefers-reduced-motion: reduce)',
  })) as typeof window.matchMedia;
}

/** On the page, so its styles can be read back the way the helper reads them. */
function make(tag: 'dialog' | 'div'): HTMLElement {
  return document.body.appendChild(document.createElement(tag));
}

function lastStarted(): Started {
  const tween = started.at(-1);

  if (tween === undefined) {
    throw new Error('Nothing was tweened.');
  }

  return tween;
}

beforeEach(() => {
  started.length = 0;
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('GIVEN somebody who has asked for less movement', () => {
  beforeEach(() => {
    asksForLessMotion(true);
  });

  describe('WHEN a dialog is closed', () => {
    it('THEN it is taken away at once, with nothing tweened first', () => {
      const dialog = make('dialog');
      const takeAway = vi.fn();

      leave(dialog, 'dialog', takeAway);

      expect(takeAway).toHaveBeenCalledOnce();
      expect(started).toEqual([]);
    });
  });

  describe('WHEN a section unfolds', () => {
    it('THEN it is simply there, drawn as its stylesheet says', () => {
      const section = make('div');

      arrive(section, 'reveal');

      expect(started).toEqual([]);
      expect(section.getAttribute('style') ?? '').toBe('');
    });
  });
});

describe('GIVEN the app moving things into place', () => {
  beforeEach(() => {
    asksForLessMotion(false);
  });

  describe('WHEN a panel opens', () => {
    it('THEN it is drawn hidden before its first frame, not open and then snapped shut', () => {
      const panel = make('dialog');

      arrive(panel, 'panel');

      expect(panel.style.opacity).toBe('0');
      expect(lastStarted().keyframes.opacity).toEqual(['0', '1']);
    });

    it('THEN it takes as long as anything arriving takes', () => {
      arrive(make('dialog'), 'panel');

      expect(lastStarted().options.duration).toBe(motionDurationMs.arrive / 1000);
    });

    it('THEN once it is in place the stylesheet has it back', async () => {
      const panel = make('dialog');

      arrive(panel, 'panel');
      await lastStarted().finish();

      expect(panel.getAttribute('style') ?? '').toBe('');
    });
  });

  describe('WHEN a dialog is closed', () => {
    it('THEN it stays until it has finished leaving, and goes then', async () => {
      const dialog = make('dialog');
      const takeAway = vi.fn();

      leave(dialog, 'dialog', takeAway);

      expect(takeAway).not.toHaveBeenCalled();

      await lastStarted().finish();

      expect(takeAway).toHaveBeenCalledOnce();
    });
  });

  describe('WHEN a menu is opened again while it is still closing', () => {
    it('THEN the closing stops where it stands, and never takes the menu away', async () => {
      const menu = make('div');
      const takeAway = vi.fn();

      leave(menu, 'menu', takeAway);
      const closing = lastStarted();

      arrive(menu, 'menu');
      await closing.finish();

      expect(closing.stop).toHaveBeenCalledOnce();
      expect(takeAway).not.toHaveBeenCalled();
    });

    it('THEN it comes back from where it had got to, not from hidden', () => {
      const menu = make('div');

      leave(menu, 'menu', vi.fn());
      arrive(menu, 'menu');

      expect(lastStarted().keyframes.opacity).toEqual(['0.4', '1']);
    });
  });

  describe('WHEN a panel is closed while it is still opening', () => {
    it('THEN it turns round from where it was, rather than finishing opening first', () => {
      const panel = make('dialog');

      arrive(panel, 'panel');
      const opening = lastStarted();

      leave(panel, 'panel', vi.fn());

      expect(opening.stop).toHaveBeenCalledOnce();
      expect(lastStarted().keyframes.opacity).toEqual(['0.4', '0']);
    });
  });
});
