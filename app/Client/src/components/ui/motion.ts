import { animate } from 'motion/mini';
import { useLayoutEffect, useRef, useState } from 'react';

import { motionDurationMs, motionEasing } from '../../tokens/motion-tokens.js';

/**
 * Everything in the app that appears, disappears or changes size moves through
 * here.
 *
 * One place for three things that used to be decided per stylesheet: how long
 * a movement takes, the curve it takes it along, and whether somebody has asked
 * for less movement. Components name what is moving — a dialog, a menu, a
 * section unfolding — and this decides how. Nothing else imports the animation
 * library; the lint config holds that line.
 *
 * Motion's small `animate`, which hands each tween straight to the browser's own
 * animations. The larger one keeps a record of every value it has set and
 * writes it back a frame later, which put a transform back on a panel after it
 * had been handed back to its stylesheet — and it refuses to tween between two
 * plain numbers written as strings, which is how every value here arrives when
 * it is read off the page.
 */

/**
 * What is moving, named for what it is rather than for how it moves.
 *
 * - `dialog`: a small modal, a question or a form, growing into place.
 * - `panel`: a card or an asset opened over the screen, rising into place.
 * - `swap`: a panel's contents giving way to another's, when one asset opens a
 *   linked one in its place.
 * - `fade`: a message arriving and leaving, deliberately without moving — a
 *   box whose edges are somewhere else for the first frames is a dismiss button
 *   somebody is aiming at and missing.
 * - `menu`: a list dropping open from the control that opened it.
 * - `reveal`: a section unfolding to its own height and folding away again.
 */
export type Movement = 'dialog' | 'panel' | 'swap' | 'fade' | 'menu' | 'reveal';

type Styles = Readonly<Record<string, string>>;

/** Where a movement starts from when it arrives, and ends when it leaves. */
const HIDDEN: Readonly<Record<Exclude<Movement, 'reveal'>, Styles>> = {
  dialog: { opacity: '0', transform: 'translateY(0px) scale(0.97)', '--backdrop-shown': '0' },
  panel: { opacity: '0', transform: 'translateY(16px) scale(0.99)', '--backdrop-shown': '0' },
  swap: { opacity: '0', transform: 'translateX(12px)' },
  fade: { opacity: '0' },
  menu: { opacity: '0', transform: 'translateY(0px) scale(0.96)' },
};

/** Where every movement comes to rest: the element as its stylesheet draws it. */
const SHOWN: Readonly<Record<Exclude<Movement, 'reveal'>, Styles>> = {
  dialog: { opacity: '1', transform: 'translateY(0px) scale(1)', '--backdrop-shown': '1' },
  panel: { opacity: '1', transform: 'translateY(0px) scale(1)', '--backdrop-shown': '1' },
  swap: { opacity: '1', transform: 'translateX(0px)' },
  fade: { opacity: '1' },
  menu: { opacity: '1', transform: 'translateY(0px) scale(1)' },
};

/**
 * The tween each element is in the middle of, if any.
 *
 * Starting a new one stops the old one where it stands and carries on from
 * there, which is what lets a panel be closed while it is still opening — it
 * turns round from wherever it had got to rather than jumping to open first.
 */
const running = new WeakMap<HTMLElement, ReturnType<typeof animate>>();

/**
 * Whether somebody has asked for less movement.
 *
 * Asked every time rather than once, so changing the setting takes effect on
 * the next thing that moves rather than on the next page load. With it on,
 * nothing tweens at all: things arrive and leave in a single frame, as they
 * did before any of this existed.
 */
export function prefersLessMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Moves an element into place from wherever it is now.
 *
 * From hidden if nothing was moving it, or from the middle of whatever it was
 * doing if something was — a menu opened again while it was still closing
 * comes back from where it had got to.
 */
export function arrive(element: HTMLElement, movement: Movement): void {
  const interrupted = halt(element);

  if (prefersLessMotion()) {
    settle(element);

    return;
  }

  const [hidden, shown] = endsOf(element, movement);
  const from = interrupted ? whereItIs(element, hidden) : hidden;

  // Written straight away rather than left to the tween's first frame, which
  // is a frame after this one: in between, the element would be drawn where it
  // is going and then snap back to set off.
  applyStyles(element, from);
  clipWhileItMoves(element, movement);

  start(element, { from, to: shown, way: 'arrive' }, () => {
    settle(element);
  });
}

/**
 * Moves an element out of sight, then hands over to whatever takes it away.
 *
 * `then` is where it leaves the page: the dialog closes, the section unmounts.
 * It runs once the tween has finished, and not at all if something else starts
 * moving the element first — a menu opened again halfway through closing is a
 * menu that stays.
 */
export function leave(element: HTMLElement, movement: Movement, then: () => void): void {
  halt(element);

  if (prefersLessMotion()) {
    then();

    return;
  }

  const [hidden, shown] = endsOf(element, movement);

  clipWhileItMoves(element, movement);
  start(element, { from: whereItIs(element, shown), to: hidden, way: 'leave' }, then);
}

/**
 * Stops whatever is moving the element, leaving it where it stands.
 *
 * True if something was. Called before every new tween, and by anything that
 * is about to take the element away without one.
 */
export function halt(element: HTMLElement): boolean {
  const controls = running.get(element);

  if (controls === undefined) {
    return false;
  }

  running.delete(element);
  controls.stop();

  return true;
}

/**
 * Moves an element from the width it was drawn at to the width it is now.
 *
 * For something whose width is its stylesheet's to decide, like the sidebar
 * narrowing to its icons: the class changes, and this carries it across the
 * difference rather than letting it jump. `fromPx` is measured just before the
 * change, which is the only moment the old width can still be read.
 */
export function resize(element: HTMLElement, fromPx: number): void {
  halt(element);
  element.style.removeProperty('width');

  const toPx = element.getBoundingClientRect().width;

  if (prefersLessMotion() || fromPx === toPx) {
    settle(element);

    return;
  }

  const from = { width: `${String(fromPx)}px` };

  applyStyles(element, from);
  start(element, { from, to: { width: `${String(toPx)}px` }, way: 'arrive' }, () => {
    settle(element);
  });
}

/**
 * A section that unfolds is clipped while it does, or its contents spill past
 * a box that is still only part of their height.
 */
function clipWhileItMoves(element: HTMLElement, movement: Movement): void {
  if (movement === 'reveal') {
    element.style.overflow = 'hidden';
  }
}

/** One tween: both of its ends, and whether the thing is coming or going. */
interface Tween {
  readonly from: Styles;
  readonly to: Styles;
  readonly way: 'arrive' | 'leave';
}

function start(element: HTMLElement, { from, to, way }: Tween, then: () => void): void {
  /*
   * Both ends spelled out, never just the destination.
   *
   * Given only where to go, the library starts from the last value it set
   * itself — which for a section is the height it had when it last finished
   * unfolding, however much has been added to it since.
   */
  const keyframes = Object.fromEntries(
    Object.entries(to).map(([property, value]) => [property, [from[property] ?? value, value]]),
  );

  const controls = animate(element, keyframes, {
    duration: motionDurationMs[way] / 1000,
    ease: [...motionEasing[way]],
  });

  running.set(element, controls);

  void controls.finished.then(() => {
    // Something else started moving it in the meantime, and that is in charge
    // of where it ends up now.
    if (running.get(element) !== controls) {
      return;
    }

    running.delete(element);
    then();
  });
}

/**
 * The element as it is drawn right now, for each property a tween is about to
 * move.
 *
 * Read from the page rather than assumed, so a tween that takes over halfway
 * through another sets off from where that one stopped. `otherwise` is for a
 * property the page has no value for, such as a custom property no stylesheet
 * has declared on this element.
 */
function whereItIs(element: HTMLElement, otherwise: Styles): Styles {
  const drawn = window.getComputedStyle(element);

  return Object.fromEntries(
    Object.entries(otherwise).map(([property, fallback]) => {
      const value = drawn.getPropertyValue(property).trim();

      return [property, value === '' ? fallback : value];
    }),
  );
}

/**
 * The two ends of a movement, as styles.
 *
 * A section unfolds to the height of what is in it, which is only known once
 * it is in the page — so `reveal` measures, and the others are fixed.
 */
function endsOf(element: HTMLElement, movement: Movement): readonly [Styles, Styles] {
  if (movement === 'reveal') {
    return [
      { height: '0px', opacity: '0' },
      { height: `${String(element.scrollHeight)}px`, opacity: '1' },
    ];
  }

  return [HIDDEN[movement], SHOWN[movement]];
}

/**
 * Hands the element back to its stylesheet.
 *
 * A tween leaves its last frame written on the element. Left there, a section
 * would stay the height it was when it finished unfolding, whatever was added
 * to it afterwards, and a panel would carry a transform that turns it into the
 * containing block for everything fixed inside it — the drag overlay among
 * them.
 */
function settle(element: HTMLElement): void {
  for (const property of WRITTEN) {
    element.style.removeProperty(property);
  }
}

/** Every property any movement writes, so settling one clears what another left. */
const WRITTEN = [
  'opacity',
  'transform',
  'height',
  'width',
  'overflow',
  '--backdrop-shown',
] as const;

function applyStyles(element: HTMLElement, styles: Styles): void {
  for (const [property, value] of Object.entries(styles)) {
    element.style.setProperty(property, value);
  }
}

/**
 * Whether something is on the page, kept on it for as long as it takes to leave.
 *
 * `{isShown && <Thing />}` takes a thing away in the same frame it was told to
 * go, with nothing left to tween. This keeps it mounted until it has finished
 * leaving, and moves it in when it comes back.
 *
 * Nothing moves on the first render: a section that starts open is simply
 * open, rather than unfolding at somebody who has only just arrived.
 */
export function usePresence<T extends HTMLElement>(
  isShown: boolean,
  movement: Movement,
): { readonly isPresent: boolean; readonly ref: React.RefObject<T | null> } {
  const [isPresent, setIsPresent] = useState(isShown);
  const ref = useRef<T>(null);
  const isFirstRender = useRef(true);

  // Mounted in the same render that asks for it, so the arrival below has an
  // element to move rather than waiting a render for one.
  if (isShown && !isPresent) {
    setIsPresent(true);
  }

  useLayoutEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;

      return;
    }

    const element = ref.current;

    if (element === null) {
      setIsPresent(isShown);

      return;
    }

    if (isShown) {
      arrive(element, movement);
    } else {
      leave(element, movement, () => {
        setIsPresent(false);
      });
    }
  }, [isShown, movement]);

  return { isPresent, ref };
}

/**
 * Moves an element in again each time what it shows is replaced.
 *
 * For a panel that opens a linked asset in its own place: the frame stays, and
 * what is in it gives way to the next thing. Not on the first value, which
 * arrives with the panel itself.
 */
export function useArrivesWith(
  ref: React.RefObject<HTMLElement | null>,
  showing: string | undefined,
  movement: Movement,
): void {
  const shown = useRef(showing);

  useLayoutEffect(() => {
    const element = ref.current;

    if (showing === undefined || showing === shown.current) {
      return;
    }

    const isFirst = shown.current === undefined;

    shown.current = showing;

    if (!isFirst && element !== null) {
      arrive(element, movement);
    }
  }, [ref, showing, movement]);
}

/**
 * An element whose width follows a value, tweened across each change.
 *
 * Call `beforeChange` just before changing the value — in the click handler —
 * so the width it is leaving can be read while it is still drawn.
 */
export function useWidthFollows<T extends HTMLElement>(
  value: unknown,
): { readonly ref: React.RefObject<T | null>; readonly beforeChange: () => void } {
  const ref = useRef<T>(null);
  const widthBefore = useRef<number | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const fromPx = widthBefore.current;

    widthBefore.current = null;

    if (element !== null && fromPx !== null) {
      resize(element, fromPx);
    }
  }, [value]);

  return {
    ref,
    beforeChange: () => {
      widthBefore.current = ref.current?.getBoundingClientRect().width ?? null;
    },
  };
}
