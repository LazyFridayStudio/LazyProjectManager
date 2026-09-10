import { useEffect, useRef } from 'react';

import styles from './Backdrop.module.css';

/** Accent, secondary and tertiary, matching the prototype's mote palette. */
const MOTE_COLORS = ['#eda363', '#63aeeb', '#63eba3'] as const;

const GRID_SPACING_PX = 46;
const PARALLAX_TRAVEL_PX = 14;
/** Motes closer than this join with a hairline. Squared, to skip a square root. */
const LINK_DISTANCE_SQUARED = 10_000;

/**
 * How loud the backdrop is.
 *
 * `sign-in` is the one the prototype drew: a full field of motes over graph
 * paper, on an empty screen where it is the only thing to look at. `app` is the
 * motes alone behind somebody's work — fewer of them, dimmer, and no grid,
 * because a decoration that competes with a board of cards is a decoration
 * people turn off.
 *
 * Fewer and dimmer, and *not* slower. It was slower and at half the frame rate
 * to begin with, which compounded into a mote crossing the screen in about seven
 * minutes — motion nobody can see is not subtle, it is a canvas that looks
 * broken. Quiet is a matter of how much there is and how bright it is.
 */
export type BackdropMood = 'sign-in' | 'app';

interface Loudness {
  readonly motes: number;
  readonly frameIntervalMs: number;
  readonly driftScale: number;
  readonly moteAlpha: number;
  readonly linkAlpha: number;
  /**
   * The graph paper behind the motes, or null for none at all.
   *
   * Null behind the app. Graph paper reads as a surface, and a surface behind
   * a board of cards is a second set of edges competing with the real ones —
   * on the sign-in screen there is nothing else to line up against, which is
   * where it earns its keep.
   */
  readonly gridAlpha: number | null;
}

const LOUDNESS: Readonly<Record<BackdropMood, Loudness>> = {
  'sign-in': {
    motes: 78,
    frameIntervalMs: 33,
    driftScale: 1,
    moteAlpha: 0.85,
    linkAlpha: 0.18,
    gridAlpha: 0.065,
  },
  app: {
    motes: 34,
    frameIntervalMs: 33,
    driftScale: 1,
    moteAlpha: 0.45,
    linkAlpha: 0.08,
    gridAlpha: null,
  },
};

interface Mote {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  radius: number;
  color: string;
}

/**
 * The animated canvas behind everything.
 *
 * Decorative only — it carries no information and is not interactive. Where it
 * draws the grid, that grid follows the pointer with a slow parallax, which is
 * why the listener sits on the window rather than the canvas: whatever is drawn
 * over it would otherwise stop the tracking the moment the cursor crossed it.
 */
export function Backdrop({ mood }: { mood: BackdropMood }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return undefined;
    }

    return startBackdropAnimation(canvas, LOUDNESS[mood]);
  }, [mood]);

  return (
    <canvas
      ref={canvasRef}
      className={mood === 'app' ? styles.behindTheApp : styles.backdrop}
      aria-hidden
    />
  );
}

/** Returns the teardown that cancels the animation and detaches the listeners. */
function startBackdropAnimation(canvas: HTMLCanvasElement, loudness: Loudness): () => void {
  const motes = createMotes(loudness);
  const pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5 };
  // Respect the OS setting: the drift and parallax are pure decoration, and for
  // anyone with a vestibular disorder they are the kind that causes symptoms.
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const trackPointer = (event: PointerEvent): void => {
    const bounds = canvas.getBoundingClientRect();

    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }

    pointer.targetX = clampToUnit((event.clientX - bounds.left) / bounds.width);
    pointer.targetY = clampToUnit((event.clientY - bounds.top) / bounds.height);
  };

  // The grid is the only thing that parallaxes, so behind the app — where there
  // is no grid — this would be a listener on every mouse movement in the
  // product, feeding a number nothing reads.
  const followsThePointer = loudness.gridAlpha !== null;

  if (followsThePointer) {
    window.addEventListener('pointermove', trackPointer, { passive: true });
  }

  let animationFrame = 0;
  let lastFrameTime = 0;

  const drawFrame = (now: number): void => {
    animationFrame = requestAnimationFrame(drawFrame);

    if (now - lastFrameTime < loudness.frameIntervalMs) {
      return;
    }

    lastFrameTime = now;
    renderBackdrop({ canvas, motes, pointer, prefersReducedMotion, loudness });
  };

  animationFrame = requestAnimationFrame(drawFrame);

  return () => {
    cancelAnimationFrame(animationFrame);

    if (followsThePointer) {
      window.removeEventListener('pointermove', trackPointer);
    }
  };
}

function createMotes(loudness: Loudness): Mote[] {
  return Array.from({ length: loudness.motes }, (_unused, index) => ({
    x: Math.random(),
    y: Math.random(),
    velocityX: (Math.random() - 0.5) * 7e-4 * loudness.driftScale,
    velocityY: (Math.random() - 0.5) * 7e-4 * loudness.driftScale,
    radius: 0.8 + Math.random() * 1.5,
    color: pickMoteColor(index),
  }));
}

/** Mostly accent, with occasional secondary and rarer tertiary flecks. */
function pickMoteColor(index: number): string {
  if (index % 9 === 0) {
    return MOTE_COLORS[2];
  }

  return index % 4 === 0 ? MOTE_COLORS[1] : MOTE_COLORS[0];
}

interface RenderOptions {
  readonly canvas: HTMLCanvasElement;
  readonly motes: Mote[];
  readonly pointer: { x: number; y: number; targetX: number; targetY: number };
  readonly prefersReducedMotion: boolean;
  readonly loudness: Loudness;
}

function renderBackdrop(options: RenderOptions): void {
  const context = options.canvas.getContext('2d');

  if (context === null) {
    return;
  }

  const { width, height } = resizeCanvasToDisplaySize(options.canvas, context);

  // Ease toward the pointer rather than snapping, which is what makes the
  // parallax read as depth instead of as a jitter.
  options.pointer.x += (options.pointer.targetX - options.pointer.x) * 0.06;
  options.pointer.y += (options.pointer.targetY - options.pointer.y) * 0.06;

  const { gridAlpha } = options.loudness;

  context.clearRect(0, 0, width, height);

  if (gridAlpha !== null) {
    drawGrid(context, { width, height, pointer: options.pointer, alpha: gridAlpha });
  }

  drawMotes(context, options, { width, height });
}

function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): { width: number; height: number } {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(bounds.width));
  const height = Math.max(1, Math.round(bounds.height));
  // Capped at 1.5: a 4K display would otherwise back a full-screen canvas with
  // four times the pixels for a decoration nobody looks at directly.
  const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);

  if (canvas.width !== Math.round(width * pixelRatio)) {
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  return { width, height };
}

function drawGrid(
  context: CanvasRenderingContext2D,
  layout: {
    width: number;
    height: number;
    pointer: { x: number; y: number };
    alpha: number;
  },
): void {
  const offsetX = (layout.pointer.x - 0.5) * -PARALLAX_TRAVEL_PX;
  const offsetY = (layout.pointer.y - 0.5) * -PARALLAX_TRAVEL_PX;

  context.lineWidth = 1;
  context.strokeStyle = `rgba(255,255,255,${String(layout.alpha)})`;
  context.beginPath();

  // The half-pixel offset puts a 1px line on a device pixel instead of straddling
  // two, which is the difference between a hairline and a grey smear.
  for (
    let column = -GRID_SPACING_PX;
    column < layout.width + GRID_SPACING_PX;
    column += GRID_SPACING_PX
  ) {
    context.moveTo(Math.round(column + offsetX) + 0.5, 0);
    context.lineTo(Math.round(column + offsetX) + 0.5, layout.height);
  }

  for (let row = -GRID_SPACING_PX; row < layout.height + GRID_SPACING_PX; row += GRID_SPACING_PX) {
    context.moveTo(0, Math.round(row + offsetY) + 0.5);
    context.lineTo(layout.width, Math.round(row + offsetY) + 0.5);
  }

  context.stroke();
}

function drawMotes(
  context: CanvasRenderingContext2D,
  options: RenderOptions,
  size: { width: number; height: number },
): void {
  const points = options.motes.map((mote) => {
    if (!options.prefersReducedMotion) {
      mote.x = wrapAroundEdges(mote.x + mote.velocityX);
      mote.y = wrapAroundEdges(mote.y + mote.velocityY);
    }

    return {
      x: mote.x * size.width,
      y: mote.y * size.height,
      radius: mote.radius,
      color: mote.color,
    };
  });

  context.lineWidth = 1;

  for (let index = 0; index < points.length; index++) {
    for (let other = index + 1; other < points.length; other++) {
      drawLinkBetween(context, { from: points[index], to: points[other] }, options.loudness);
    }
  }

  for (const point of points) {
    context.fillStyle = withAlpha(point.color, options.loudness.moteAlpha);
    context.beginPath();
    context.arc(point.x, point.y, point.radius + 0.3, 0, Math.PI * 2);
    context.fill();
  }
}

interface RenderedMote {
  x: number;
  y: number;
  radius: number;
  color: string;
}

function drawLinkBetween(
  context: CanvasRenderingContext2D,
  pair: { readonly from: RenderedMote | undefined; readonly to: RenderedMote | undefined },
  loudness: Loudness,
): void {
  const { from, to } = pair;

  if (from === undefined || to === undefined) {
    return;
  }

  const deltaX = from.x - to.x;
  const deltaY = from.y - to.y;
  const distanceSquared = deltaX * deltaX + deltaY * deltaY;

  if (distanceSquared >= LINK_DISTANCE_SQUARED) {
    return;
  }

  // Fade the link out as the motes separate, so they appear to connect and part
  // rather than blink.
  const closeness = 1 - Math.sqrt(distanceSquared) / Math.sqrt(LINK_DISTANCE_SQUARED);
  context.strokeStyle = withAlpha(MOTE_COLORS[0], closeness * loudness.linkAlpha);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
}

/** Motes leave one edge and return on the other, so the field never thins out. */
function wrapAroundEdges(position: number): number {
  if (position < -0.05) {
    return 1.05;
  }

  return position > 1.05 ? -0.05 : position;
}

function withAlpha(hexColor: string, alpha: number): string {
  const value = parseInt(hexColor.slice(1), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;

  return `rgba(${String(red)},${String(green)},${String(blue)},${String(alpha)})`;
}

function clampToUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}
