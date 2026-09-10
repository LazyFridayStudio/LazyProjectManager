/**
 * The marks more than one screen draws.
 *
 * Inline SVG on the same terms as `nav-icons.tsx` and `doc-icons.tsx`: a
 * handful of shapes, they never change independently of the code using them,
 * and a font would be a network request and a flash of missing glyphs for a few
 * strokes. They live here rather than beside one screen because more than one
 * screen needs them, and a second copy is how two bins become different bins.
 */

/**
 * A bin. What every control that takes something away is marked with.
 *
 * Always a bin, never a cross. A cross means dismiss, close, or put this panel
 * away — and a control marked with one that instead destroys something is
 * indistinguishable from one that does not, at exactly the moment somebody is
 * about to lose work. The colour says it is dangerous; the mark says what kind
 * of dangerous.
 *
 * Sized by the caller rather than by CSS. It is drawn at sixteen beside a
 * document's title and at twelve inside a chip, and a mark scaled by a
 * stylesheet keeps the stroke weight of the size it was drawn for — which is
 * how one of a set of icons ends up heavier than the rest.
 *
 * The two ribs are what stop it reading as a cup at these sizes.
 *
 * Drawn from 2.5 to 13.5 rather than from 3.2 to 14.2, so the ink is centred on
 * the box rather than sitting seven tenths below it. A bin is top-heavy — a lid
 * across the top and a body tapering under it — so centring the box leaves the
 * mark low, which shows up the moment it sits in a row beside a checkbox.
 */
/**
 * What every mark here is drawn with.
 *
 * One box, one stroke weight and one set of caps, which is what makes a row of
 * them read as one set rather than as three icons that ended up together.
 */
function shared(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    focusable: false,
  } as const;
}

export function TrashIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...shared(size)}>
      <path d="M2.5 3.8h11" />
      <path d="M6.2 3.8V2.5h3.6v1.3" />
      <path d="M4 3.8l.6 8.6a1.2 1.2 0 0 0 1.2 1.1h4.4a1.2 1.2 0 0 0 1.2-1.1L12 3.8" />
      <path d="M6.6 6.7v4.2" />
      <path d="M9.4 6.7v4.2" />
    </svg>
  );
}

/**
 * A plus. What every control that makes a new thing is marked with.
 *
 * Two strokes crossing at the centre of the box, so the mark is centred by its
 * own geometry — see the note on the bin about why that is worth stating.
 */
export function PlusIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...shared(size)}>
      <path d="M8 3.2v9.6" />
      <path d="M3.2 8h9.6" />
    </svg>
  );
}

/**
 * A pencil. What every control that changes a thing in place is marked with.
 *
 * Drawn corner to corner, tip at the bottom left, so it fills the box on the
 * diagonal and reads at twelve pixels — a smaller pencil parallel to an edge is
 * a smudge at this size. The short stroke across it is the ferrule, which is
 * what stops it reading as an arrow.
 *
 * Ink runs 2.4 to 13.6 both ways, so it is centred on the box like the others.
 */
export function PencilIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...shared(size)}>
      <path d="M11.1 2.4a1.8 1.8 0 0 1 2.5 2.5L5.7 12.8l-3.3.8.8-3.3z" />
      <path d="M9.9 3.6 12.4 6.1" />
    </svg>
  );
}

/**
 * An arrow into a tray. What a control that hands somebody a file is marked
 * with.
 *
 * Not one of the three the mark rule enforces — a download makes nothing,
 * changes nothing and takes nothing away. It is here because it is drawn on
 * more than one screen's worth of rows and belongs to the same set: one box,
 * one stroke weight, one set of caps.
 *
 * Ink runs 2.4 to 13.6, so it is centred on its own box like the others.
 */
export function DownloadIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...shared(size)}>
      <path d="M8 2.4v7.4" />
      <path d="M4.8 7 8 10.2 11.2 7" />
      <path d="M2.8 11.4v1.2a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.2" />
    </svg>
  );
}

/**
 * How wide the triangle is drawn across the box, in the box's own units.
 *
 * It fills the box rather than sitting inside it. The mark this replaces was
 * the characters ▾ and ▸, both named SMALL TRIANGLE, and drawn on a canvas at
 * sixteen pixels they measure 7×5 and 6×5 — a third of the room a font gives
 * them. That is why four screens each reserved a different width for the same
 * arrow and none of them changed how large it looked: the size was the font's
 * to decide, not theirs.
 */
const CHEVRON_ACROSS = 16;

/** From the flat edge to the point, leaving it wider than it is deep. */
const CHEVRON_DEEP = 10;

/** What is left of the square either side of the triangle, to centre it. */
const CHEVRON_INSET = (CHEVRON_ACROSS - CHEVRON_DEEP) / 2;

const POINTING_DOWN = `M0 ${String(CHEVRON_INSET)} H${String(CHEVRON_ACROSS)} L${String(CHEVRON_ACROSS / 2)} ${String(CHEVRON_INSET + CHEVRON_DEEP)} Z`;

const POINTING_RIGHT = `M${String(CHEVRON_INSET)} 0 L${String(CHEVRON_INSET + CHEVRON_DEEP)} ${String(CHEVRON_ACROSS / 2)} L${String(CHEVRON_INSET)} ${String(CHEVRON_ACROSS)} Z`;

/**
 * Whether the thing this sits on is open: down when it is, along when it is not.
 *
 * Filled, and so the one mark here that does not go through `shared`. The rest
 * are actions — a bin, a plus, a pencil — and a stroked outline is what tells
 * somebody they are things to press. This is not an action but a state, it is
 * drawn as small as ten pixels in a legend chip, and a 1.4px outline round a
 * ten-pixel triangle is a smudge with a hole in it. A solid disclosure triangle
 * is also what every list somebody has ever opened uses.
 *
 * Square whatever the size, so turning it does not shift what follows it along.
 * The characters got that for free from a monospace face; a drawn mark has to
 * be given it.
 *
 * Sized by the caller, like every mark here, and given a class rather than a
 * colour: the four screens that draw one want four different colours and the
 * same arrow.
 */
export function ChevronIcon({
  isOpen,
  size = 16,
  className,
}: {
  readonly isOpen: boolean;
  readonly size?: number;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${String(CHEVRON_ACROSS)} ${String(CHEVRON_ACROSS)}`}
      fill="currentColor"
      aria-hidden
      focusable={false}
    >
      <path d={isOpen ? POINTING_DOWN : POINTING_RIGHT} />
    </svg>
  );
}
