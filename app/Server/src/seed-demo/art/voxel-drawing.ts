/**
 * How the demo's pictures are drawn.
 *
 * Two shapes make all of them: a cube seen from the corner, and a sprite made
 * of square pixels. That is the whole vocabulary of the game the demo is about,
 * so it is the whole vocabulary here — and it means the art is a few hundred
 * lines of arithmetic rather than a folder of binary files nobody can review.
 *
 * Everything returns SVG, and every number is worked out rather than measured,
 * so the same seed run always produces the same bytes.
 */

/** A colour a fraction lighter or darker, as `#rrggbb`. */
export function shadeOf(colour: string, factor: number): string {
  const value = Number.parseInt(colour.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];

  return `#${channels
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor))))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * A repeatable number between 0 and 1 for a named square.
 *
 * A texture has to come out the same every time the demo is seeded — a picture
 * that changed on a re-run would be a new file for a thing nobody touched — so
 * this is a hash of the name rather than a random number.
 */
export function jitterFor(name: string, row: number, column: number): number {
  const seed = `${name}:${String(row)}:${String(column)}`;
  let hash = 2166136261;

  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return ((hash >>> 0) % 1000) / 1000;
}

/** How far a square's shade may wander from the colour of the face it is on. */
const SHADE_SPREAD = 0.14;

/** Two decimal places is more than a screen can tell apart, and half the bytes. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

type Point = readonly [number, number];

function polygon(points: readonly Point[], fill: string): string {
  const drawn = points
    .map(([across, down]) => `${String(round(across))},${String(round(down))}`)
    .join(' ');

  return `<polygon points="${drawn}" fill="${fill}"/>`;
}

interface FaceRequest {
  readonly origin: Point;
  /** The edge the squares run along. */
  readonly across: Point;
  /** The edge they run down. */
  readonly down: Point;
  readonly colour: string;
  readonly name: string;
  readonly face: string;
  /** A different colour for the top row, which is what makes grass grass. */
  readonly fringe?: string | undefined;
  readonly tiles: number;
}

/**
 * One face of a cube, as a grid of squares.
 *
 * `across` and `down` are the two edges rather than a width and a height, so
 * the same code draws the rhombus on top and the flat sides underneath it.
 */
function facePixels(request: FaceRequest): string {
  const { origin, across, down, colour, name, face, fringe, tiles } = request;
  const parts: string[] = [];

  for (let row = 0; row < tiles; row += 1) {
    for (let column = 0; column < tiles; column += 1) {
      const base = fringe !== undefined && row === 0 ? fringe : colour;
      const wander = (jitterFor(`${name}:${face}`, row, column) - 0.5) * 2 * SHADE_SPREAD;
      const corner: Point = [
        origin[0] + (across[0] * column) / tiles + (down[0] * row) / tiles,
        origin[1] + (across[1] * column) / tiles + (down[1] * row) / tiles,
      ];
      const stepAcross: Point = [across[0] / tiles, across[1] / tiles];
      const stepDown: Point = [down[0] / tiles, down[1] / tiles];

      parts.push(
        polygon(
          [
            corner,
            [corner[0] + stepAcross[0], corner[1] + stepAcross[1]],
            [corner[0] + stepAcross[0] + stepDown[0], corner[1] + stepAcross[1] + stepDown[1]],
            [corner[0] + stepDown[0], corner[1] + stepDown[1]],
          ],
          shadeOf(base, 1 + wander),
        ),
      );
    }
  }

  return parts.join('');
}

export interface IsometricBlockRequest {
  /** The topmost corner of the block. */
  readonly x: number;
  readonly y: number;
  /** Half the width of the top face, which is also the height of a side. */
  readonly size: number;
  /** What the squares are shaded from, so two blocks are never identical. */
  readonly name: string;
  readonly top: string;
  readonly left: string;
  readonly right: string;
  /** The colour of the first row of each side: the grass over the dirt. */
  readonly fringe?: string | undefined;
  /** Squares per edge. Fewer on a picture that draws a hundred blocks. */
  readonly tiles?: number;
}

/**
 * A block, drawn the way the game draws one.
 *
 * Three faces, because the other three are behind it. The vertical edge is the
 * same length as half the top face's width, which is what makes a cube read as
 * a cube in this projection rather than as a squashed box.
 */
export function isometricBlock(request: IsometricBlockRequest): string {
  const { x, y, size, name, top, left, right, fringe, tiles = 4 } = request;
  const half = size / 2;

  return [
    '<g>',
    facePixels({
      origin: [x, y],
      across: [size, half],
      down: [-size, half],
      colour: top,
      name,
      face: 'top',
      tiles,
    }),
    facePixels({
      origin: [x - size, y + half],
      across: [size, half],
      down: [0, size],
      colour: left,
      name,
      face: 'left',
      fringe,
      tiles,
    }),
    facePixels({
      origin: [x, y + size],
      across: [size, -half],
      down: [0, size],
      colour: right,
      name,
      face: 'right',
      fringe,
      tiles,
    }),
    '</g>',
  ].join('');
}

export interface PixelSpriteRequest {
  /** One string per row, one character per pixel. */
  readonly rows: readonly string[];
  /** What each character is coloured. A character with no colour is nothing. */
  readonly palette: Readonly<Record<string, string>>;
  readonly x: number;
  readonly y: number;
  /** How large one pixel is drawn. */
  readonly pixel: number;
}

/**
 * A sprite, from rows of characters and what each character is coloured.
 *
 * Runs of the same colour become one rectangle, which keeps a sixteen-square
 * sprite to a couple of dozen shapes rather than to 256 of them.
 */
export function pixelSprite(request: PixelSpriteRequest): string {
  const { rows, palette, x, y, pixel } = request;
  const parts: string[] = [];

  rows.forEach((row, rowIndex) => {
    let column = 0;

    while (column < row.length) {
      const character = row[column] ?? '';
      const fill = palette[character];

      if (fill === undefined) {
        column += 1;
        continue;
      }

      let run = 1;

      while (row[column + run] === character) run += 1;

      parts.push(
        [
          `<rect x="${String(round(x + column * pixel))}"`,
          `y="${String(round(y + rowIndex * pixel))}"`,
          `width="${String(round(run * pixel))}"`,
          `height="${String(round(pixel))}"`,
          `fill="${fill}"/>`,
        ].join(' '),
      );

      column += run;
    }
  });

  return parts.join('');
}

export interface SvgDocumentRequest {
  readonly width: number;
  readonly height: number;
  readonly body: string;
  /** What a screen reader is told the picture is. */
  readonly title: string;
}

/** The document every picture is wrapped in. */
export function svgDocument({ width, height, body, title }: SvgDocumentRequest): string {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    ` viewBox="0 0 ${String(width)} ${String(height)}"`,
    ` width="${String(width)}" height="${String(height)}"`,
    ` role="img" aria-label="${title}">`,
    body,
    '</svg>',
  ].join('');
}
