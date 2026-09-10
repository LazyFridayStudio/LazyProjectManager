/**
 * The icons in the design doc's header.
 *
 * Inline SVG on the same terms as the nav's icons: a handful of shapes, they
 * never change independently of this file, and a font would be a network
 * request and a flash of missing glyphs for a few strokes.
 *
 * They share a box, a stroke weight and round caps, which is what makes a row
 * of them read as one set. Corner brackets rather than arrows for the width,
 * because that is the mark a video player puts on the same control and the one
 * people already read as "make this take the whole width".
 */

const SHARED = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

/** Brackets pushing out to the corners: give it the whole width. */
export function FullScreenIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <path d="M6 2H2v4" />
      <path d="M10 2h4v4" />
      <path d="M14 10v4h-4" />
      <path d="M2 10v4h4" />
    </svg>
  );
}

/** The same brackets pulled in: hold it to a reading measure. */
export function SafeModeIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <path d="M2 6h4V2" />
      <path d="M14 6h-4V2" />
      <path d="M14 10h-4v4" />
      <path d="M2 10h4v4" />
    </svg>
  );
}

/**
 * A document leaving, and a document arriving.
 *
 * The same three strokes both times, with the arrow turned over: the line is
 * the edge of the app, and which way the arrow points is the whole difference
 * between the two. Mirrored the way the width brackets are, because a pair that
 * shares its shape is a pair somebody reads once and knows twice.
 *
 * The line is the app, and the arrow says which way the document is going: up
 * off it is one leaving, down onto it is one arriving. Read as the document
 * moving rather than as a transfer to somewhere — a document is the thing
 * somebody is thinking about here, not the direction of a copy.
 */
export function ExportIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <path d="M8 9.8V2.2" />
      <path d="M5 5.2 8 2.2l3 3" />
      <path d="M2.5 13.5h11" />
    </svg>
  );
}

/** The same mark, arrow turned over: a document coming in off the disk. */
export function ImportIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <path d="M8 2.2v7.6" />
      <path d="M5 6.8 8 9.8l3-3" />
      <path d="M2.5 13.5h11" />
    </svg>
  );
}

/**
 * A luggage tag: what the document is called.
 *
 * Not a pencil, and that is the whole decision. The pencil belongs to `Edit
 * document`, which is the way into writing the thing — two pencils side by side
 * would make the pair a coin toss, and the pair is the point: what it is called
 * and what it says.
 *
 * A tag is the mark for a name rather than for changing one, which is a small
 * stretch. The name is still on the button, which is what a screen reader reads
 * and what a hover shows, and the alternative was two identical marks doing
 * different jobs.
 *
 * Here rather than in the shared set: only this screen renames anything. It
 * moves the day a second one does, the way the bin did.
 */
export function TagIcon(): React.JSX.Element {
  return (
    <svg {...SHARED}>
      <path d="M7.7 2.5h5.1a.7.7 0 0 1 .7.7v5.1a1 1 0 0 1-.29.71l-4.5 4.5a1 1 0 0 1-1.42 0l-5.1-5.1a1 1 0 0 1 0-1.42l4.5-4.5a1 1 0 0 1 .71-.29z" />
      <circle cx="10.9" cy="5.1" r="1" />
    </svg>
  );
}
