import { useEffect, useRef } from 'react';

import { MarkdownText } from './MarkdownText.js';
import { listImages, setImagePlacement } from '../../logic/markdown/image-placement.js';
import {
  readPlacement,
  type ImageAlignment,
  type ImagePlacement,
} from '../../logic/markdown/render-markdown.js';
import styles from './MarkdownEditorPreview.module.css';

/** Small enough to still be an image, rather than a line. */
const SMALLEST_SCALE = 0.05;

/** Half the handle's width, so the bar straddles the edge it resizes. */
const HANDLE_REACH = 5;

const INSET = 6;

const ALIGNMENTS: readonly { value: ImageAlignment; glyph: string; label: string }[] = [
  { value: 'left', glyph: '⇤', label: 'Align left' },
  { value: 'center', glyph: '↔', label: 'Centre' },
  { value: 'right', glyph: '⇥', label: 'Align right' },
];

export interface MarkdownEditorPreviewProps {
  readonly source: string;
  readonly onChange: (source: string) => void;
}

/**
 * The Preview tab: what the markdown will look like, with its images resizable.
 *
 * The handles live here rather than in read mode, because read mode changes
 * nothing — and they cannot live in the Raw tab, which is showing the markdown
 * rather than the picture. A preview is the one place both are true.
 *
 * Dragging rewrites the markdown, which stays the only place a size is stored.
 */
export function MarkdownEditorPreview({
  source,
  onChange,
}: MarkdownEditorPreviewProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  // Read inside pointer handlers that outlive the render they were made in.
  const latest = useRef({ source, onChange });

  latest.current = { source, onChange };

  useEffect(() => {
    const root = container.current;

    if (root === null) {
      return undefined;
    }

    const undos = [...root.querySelectorAll('img')].map((image, index) =>
      decorate(image, index, latest),
    );

    return () => {
      for (const undo of undos) {
        undo();
      }
    };
  }, [source]);

  if (source.trim() === '') {
    return <p className={styles.empty}>Nothing to preview yet.</p>;
  }

  return (
    <div className={styles.preview} ref={container}>
      <MarkdownText source={source} />
    </div>
  );
}

interface LatestProps {
  readonly current: { source: string; onChange: (source: string) => void };
}

/**
 * Puts a frame, a resize handle and alignment buttons around one image.
 *
 * Built in the DOM rather than in JSX because the markdown is rendered as HTML —
 * there are no React elements to hang them off. Everything made here is removed
 * when the source changes and the preview is rebuilt, which is also how a change
 * of alignment reaches the screen.
 */
function decorate(image: HTMLImageElement, index: number, latest: LatestProps): () => void {
  const parent = image.parentElement;

  if (parent === null) {
    return () => undefined;
  }

  const placement = placementAt(index, latest);

  const frame = document.createElement('span');
  frame.className = styles.imageFrame ?? '';
  parent.insertBefore(frame, image);
  frame.append(image);

  const readout = buildReadout();
  const alignmentBar = buildAlignment(index, latest, placement.alignment);
  const handle = buildHandle({ index, latest, frame, image, readout, placement });
  const overlays = { image, frame, alignmentBar, handle, readout, alignment: placement.alignment };

  frame.append(alignmentBar, handle, readout);
  position(overlays);

  // The image is a percentage of the description's width, so it resizes when the
  // panel does — and the furniture has to follow it there too.
  const watcher = new ResizeObserver(() => {
    position(overlays);
  });
  watcher.observe(image);

  return () => {
    watcher.disconnect();

    if (frame.parentNode === parent) {
      parent.insertBefore(image, frame);
      frame.remove();
    }
  };
}

interface Overlays {
  readonly image: HTMLImageElement;
  readonly frame: HTMLElement;
  readonly alignmentBar: HTMLElement;
  readonly handle: HTMLElement;
  readonly readout: HTMLElement;
  readonly alignment: ImageAlignment;
}

/**
 * Lines the furniture up with the image rather than with the frame around it.
 *
 * The frame is as wide as the description, so a percentage width in the markdown
 * means the same fraction it would mean in read mode. That leaves the image free
 * to sit anywhere along the frame, so the handle has to be told where its edge
 * actually is — and it goes on the edge that moves, which for a right-aligned
 * image is the left one.
 */
function position({ image, frame, alignmentBar, handle, readout, alignment }: Overlays): void {
  const left = image.offsetLeft;
  const right = frame.clientWidth - (left + image.offsetWidth);
  const movingEdge = alignment === 'right' ? left : left + image.offsetWidth;

  alignmentBar.style.left = `${String(left + INSET)}px`;
  alignmentBar.style.top = `${String(image.offsetTop + INSET)}px`;

  handle.style.left = `${String(movingEdge - HANDLE_REACH)}px`;
  handle.style.top = `${String(image.offsetTop)}px`;
  handle.style.height = `${String(image.offsetHeight)}px`;

  readout.style.right = `${String(right + INSET)}px`;
  readout.style.top = `${String(image.offsetTop + image.offsetHeight - 26)}px`;
}

function buildReadout(): HTMLElement {
  const readout = document.createElement('span');
  readout.className = styles.scaleReadout ?? '';
  readout.hidden = true;

  return readout;
}

function buildAlignment(index: number, latest: LatestProps, current: ImageAlignment): HTMLElement {
  const bar = document.createElement('span');
  bar.className = styles.alignment ?? '';

  for (const alignment of ALIGNMENTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = alignment.glyph;
    button.title = alignment.label;
    button.setAttribute('aria-label', alignment.label);
    button.className = [
      styles.alignmentButton,
      current === alignment.value ? styles.alignmentButtonSelected : '',
    ]
      .filter(Boolean)
      .join(' ');

    button.addEventListener('click', (event) => {
      event.preventDefault();
      apply(index, latest, { ...placementAt(index, latest), alignment: alignment.value });
    });

    bar.append(button);
  }

  return bar;
}

interface HandleParts {
  readonly index: number;
  readonly latest: LatestProps;
  readonly frame: HTMLElement;
  readonly image: HTMLImageElement;
  readonly readout: HTMLElement;
  readonly placement: ImagePlacement;
}

/**
 * The bar on the image's moving edge, which is what is dragged to scale it.
 *
 * The width is set on the image while dragging so the size can be seen, and
 * written into the markdown once, on release — a description that rewrote itself
 * on every pointer move would fill the undo history with a single drag.
 */
function buildHandle({
  index,
  latest,
  frame,
  image,
  readout,
  placement,
}: HandleParts): HTMLElement {
  const handle = document.createElement('span');
  handle.className = styles.handle ?? '';
  handle.setAttribute('role', 'presentation');
  handle.title = 'Drag to resize';

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);

    let dragged: number | null = null;

    const onMove = (move: PointerEvent): void => {
      dragged = scaleFromPointer(move.clientX, frame.getBoundingClientRect(), placement.alignment);
      image.style.width = asPercentage(dragged);
      readout.hidden = false;
      readout.textContent = asPercentage(dragged);
    };

    const onUp = (): void => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      readout.hidden = true;

      // A click that never moved is not a resize, and writing one back would
      // mark the card changed without changing anything.
      if (dragged !== null) {
        apply(index, latest, { ...placement, scale: dragged });
      }
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });

  return handle;
}

/**
 * How wide the image is if its moving edge is under the pointer.
 *
 * Measured from the edge the alignment pins, which is the one that stays put: a
 * centred image grows from the middle outwards, so it gains twice what the
 * pointer travels.
 */
function scaleFromPointer(pointerX: number, box: DOMRect, alignment: ImageAlignment): number {
  if (alignment === 'left') {
    return clamp((pointerX - box.left) / box.width);
  }

  if (alignment === 'right') {
    return clamp((box.right - pointerX) / box.width);
  }

  return clamp((2 * (pointerX - (box.left + box.width / 2))) / box.width);
}

/** The nth image's placement, or how an image with no title of its own is drawn. */
function placementAt(index: number, latest: LatestProps): ImagePlacement {
  return listImages(latest.current.source)[index]?.placement ?? readPlacement(null);
}

function apply(index: number, latest: LatestProps, placement: ImagePlacement): void {
  latest.current.onChange(setImagePlacement(latest.current.source, index, placement));
}

function asPercentage(scale: number): string {
  return `${String(Math.round(scale * 100))}%`;
}

function clamp(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1;
  }

  return Math.min(1, Math.max(SMALLEST_SCALE, Math.round(scale * 100) / 100));
}
