import { isometricBlock, jitterFor, pixelSprite, shadeOf, svgDocument } from './voxel-drawing.js';

/**
 * The pictures the demo comes with.
 *
 * The demo used to be a studio with nothing to look at: every tile drew a
 * filename, the launcher drew the project's name in letters, and a screenshot
 * of the library was a grid of grey boxes. None of that is what the screens
 * look like in use, and the demo exists to show what they look like in use.
 *
 * Drawn here rather than shipped as files because the game the demo is making
 * is made of cubes and square pixels, and both are arithmetic. A `.png` in the
 * repository is a thing nobody can review, resize or recolour; this is a
 * hundred lines that produce a picture at any size, in one style, from a palette
 * that can be changed in one place.
 */

export interface DemoPicture {
  /** What it is a picture of, which is what the seed files it under. */
  readonly name: string;
  readonly filename: string;
  readonly width: number;
  readonly height: number;
  readonly svg: string;
}

/** Every colour the demo art is made of, named for the thing it draws. */
const COLOURS = {
  skyHigh: '#4ea3e0',
  skyLow: '#a8dcf5',
  duskHigh: '#2b3a63',
  duskLow: '#6d5b8f',
  nightHigh: '#141b2e',
  nightLow: '#2a3a5c',
  slateHigh: '#37414f',
  slateLow: '#5b6a7d',

  grass: '#6ab04c',
  grassDark: '#4d8a34',
  dirt: '#8b6239',
  dirtDark: '#6f4c2c',
  stone: '#9aa0a6',
  stoneDark: '#787f86',
  stoneEdge: '#565d64',
  stoneBlade: '#bcc2c8',
  cobble: '#8a9096',
  bark: '#7d5a34',
  barkTop: '#b98d55',
  planks: '#c08d52',
  leaves: '#37782b',
  sand: '#e3d2a0',
  sandDark: '#c2ae76',
  gravel: '#9c9186',

  slime: '#79d454',
  slimeDark: '#4e9b3a',
  wisp: '#ffd66b',
  wispDark: '#e0a83c',
  crawler: '#4a3f52',
  crawlerDark: '#332b3a',
  eye: '#e0503a',

  iron: '#cfd4d8',
  ironDark: '#9aa1a8',
  handle: '#8a6136',
  handleDark: '#6a4826',
  flame: '#ffbe4d',
  flameHot: '#ffe9a3',
  water: '#4a90d9',

  ink: '#1a1f2b',
  chalk: '#f2f2f2',
  paper: '#161b26',
  slate: '#1b2233',
  caption: '#8c93a1',
  rule: '#2f3a52',
  shadow: '#00000033',
} as const;

/**
 * The one font stack every picture writes in.
 *
 * An SVG in an `<img>` cannot load a font, so this has to be a list of faces a
 * machine already has. Verdana is on every Windows and Mac; DejaVu Sans is what
 * a Linux box has instead.
 */
const LETTERING = 'Verdana, DejaVu Sans, sans-serif';

interface BackdropRequest {
  readonly width: number;
  readonly height: number;
  readonly high: string;
  readonly low: string;
}

function backdrop({ width, height, high, low }: BackdropRequest): string {
  return [
    '<defs><linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">',
    `<stop offset="0" stop-color="${high}"/><stop offset="1" stop-color="${low}"/>`,
    '</linearGradient></defs>',
    `<rect width="${String(width)}" height="${String(height)}" fill="url(#ground)"/>`,
  ].join('');
}

/** The oval a thing sits on, so it is standing somewhere rather than floating. */
function groundShadow(centreX: number, centreY: number, radius: number): string {
  return [
    `<ellipse cx="${String(centreX)}" cy="${String(centreY)}"`,
    ` rx="${String(radius)}" ry="${String(radius / 2.6)}" fill="${COLOURS.shadow}"/>`,
  ].join('');
}

/**
 * The shape every library picture is drawn to.
 *
 * Sixteen by nine, because that is the slot: a library tile, the reference
 * sheet and the launcher are all `16 / 9` with `object-fit: contain`, so a
 * square picture would sit in the middle of the tile with the tile's own
 * background showing either side of it. Drawn to the shape it is displayed in,
 * a picture fills its slot and nothing is letterboxed or cropped.
 */
const TILE = { width: 480, height: 270 } as const;

/** Where the ground is on a tile, so everything standing on it lines up. */
const GROUND = { centreY: 208, radius: 112 } as const;

interface TilePictureRequest {
  readonly name: string;
  readonly filename: string;
  readonly high: string;
  readonly low: string;
  readonly body: string;
  /** False for a picture that is not a thing standing on the ground. */
  readonly standsOnGround?: boolean;
}

function tilePicture(request: TilePictureRequest): DemoPicture {
  const { name, filename, high, low, body, standsOnGround = true } = request;

  return {
    name,
    filename,
    ...TILE,
    svg: svgDocument({
      ...TILE,
      title: name,
      body: [
        backdrop({ ...TILE, high, low }),
        standsOnGround ? groundShadow(TILE.width / 2, GROUND.centreY, GROUND.radius) : '',
        body,
      ].join(''),
    }),
  };
}

/* -------------------------------------------------------------- blocks --- */

/** Where a second block goes when a tile draws a pair of them. */
const PAIRED_BLOCKS = { behind: { x: 190, y: 80 }, front: { x: 292, y: 56 }, size: 62 } as const;

const GRASS_BLOCK = tilePicture({
  name: 'Grass block',
  filename: 'grass-block.svg',
  high: COLOURS.skyHigh,
  low: COLOURS.skyLow,
  body: isometricBlock({
    x: 240,
    y: 38,
    size: 88,
    name: 'grass',
    top: COLOURS.grass,
    left: COLOURS.dirt,
    right: COLOURS.dirtDark,
    fringe: COLOURS.grassDark,
  }),
});

interface PairedBlockRequest {
  readonly name: string;
  readonly filename: string;
  readonly high: string;
  readonly low: string;
  readonly behind: { readonly name: string; readonly top: string; readonly side: string };
  readonly front: { readonly name: string; readonly top: string; readonly side: string };
}

/** Two blocks, for the assets that are a pair of related textures. */
function pairedBlockTile(request: PairedBlockRequest): DemoPicture {
  const { name, filename, high, low, behind, front } = request;

  return tilePicture({
    name,
    filename,
    high,
    low,
    body: [
      isometricBlock({
        ...PAIRED_BLOCKS.behind,
        size: PAIRED_BLOCKS.size,
        name: behind.name,
        top: behind.top,
        left: behind.side,
        right: shadeOf(behind.side, 0.85),
      }),
      isometricBlock({
        ...PAIRED_BLOCKS.front,
        size: PAIRED_BLOCKS.size,
        name: front.name,
        top: front.top,
        left: front.side,
        right: shadeOf(front.side, 0.85),
      }),
    ].join(''),
  });
}

const STONE_AND_COBBLE = pairedBlockTile({
  name: 'Stone and cobble',
  filename: 'stone-and-cobble.svg',
  high: COLOURS.slateHigh,
  low: COLOURS.slateLow,
  behind: { name: 'stone', top: COLOURS.stone, side: COLOURS.stoneDark },
  front: { name: 'cobble', top: COLOURS.cobble, side: shadeOf(COLOURS.cobble, 0.82) },
});

const OAK_LOG_AND_PLANKS = pairedBlockTile({
  name: 'Oak log and planks',
  filename: 'oak-log-and-planks.svg',
  high: COLOURS.skyHigh,
  low: COLOURS.skyLow,
  behind: { name: 'planks', top: COLOURS.planks, side: shadeOf(COLOURS.planks, 0.82) },
  front: { name: 'log', top: COLOURS.barkTop, side: COLOURS.bark },
});

const SAND_AND_GRAVEL = pairedBlockTile({
  name: 'Sand and gravel',
  filename: 'sand-and-gravel.svg',
  high: COLOURS.skyHigh,
  low: COLOURS.skyLow,
  behind: { name: 'gravel', top: COLOURS.gravel, side: shadeOf(COLOURS.gravel, 0.82) },
  front: { name: 'sand', top: COLOURS.sand, side: COLOURS.sandDark },
});

/* ------------------------------------------------------------- sprites --- */

/**
 * How large one pixel of a sixteen-square sprite is drawn on a tile, and where
 * the sprite is put so that it stands on the same ground the blocks do.
 */
const SPRITE = { pixel: 14, x: (TILE.width - 16 * 14) / 2, y: 20 } as const;

interface SpriteTileRequest {
  readonly name: string;
  readonly filename: string;
  readonly rows: readonly string[];
  readonly palette: Readonly<Record<string, string>>;
  readonly high: string;
  readonly low: string;
}

function spriteTile(request: SpriteTileRequest): DemoPicture {
  const { name, filename, rows, palette, high, low } = request;

  return tilePicture({
    name,
    filename,
    high,
    low,
    body: pixelSprite({ rows, palette, x: SPRITE.x, y: SPRITE.y, pixel: SPRITE.pixel }),
  });
}

const TORCH_ROWS = [
  '................',
  '................',
  '.......ff.......',
  '......fFFf......',
  '.....fFFFFf.....',
  '.....fFFFFf.....',
  '......fFFf......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......gg.......',
  '................',
  '................',
];

const TORCH = spriteTile({
  name: 'Torch',
  filename: 'torch.svg',
  high: COLOURS.nightHigh,
  low: COLOURS.nightLow,
  rows: TORCH_ROWS,
  palette: {
    f: COLOURS.flame,
    F: COLOURS.flameHot,
    h: COLOURS.handle,
    g: COLOURS.handleDark,
  },
});

const SLIME_ROWS = [
  '................',
  '................',
  '................',
  '....ssssssss....',
  '...ssSSSSSSss...',
  '..sSSSSSSSSSSs..',
  '..sSSeeSSeeSSs..',
  '..sSSeeSSeeSSs..',
  '..sSSSSSSSSSSs..',
  '..sSSSmmmmSSSs..',
  '..sSSSSSSSSSSs..',
  '...sSSSSSSSSs...',
  '....ssssssss....',
  '................',
  '................',
  '................',
];

const SLIME_PALETTE = {
  s: COLOURS.slimeDark,
  S: COLOURS.slime,
  e: COLOURS.ink,
  m: COLOURS.ink,
};

const SLIME = spriteTile({
  name: 'Slime',
  filename: 'slime.svg',
  high: COLOURS.duskHigh,
  low: COLOURS.duskLow,
  rows: SLIME_ROWS,
  palette: SLIME_PALETTE,
});

const WISP_ROWS = [
  '................',
  '.......ww.......',
  '......wWWw......',
  '.....wWWWWw.....',
  '....wWWWWWWw....',
  '....wWWFFWWw....',
  '....wWWFFWWw....',
  '....wWWWWWWw....',
  '.....wWWWWw.....',
  '......wWWw......',
  '.......ww.......',
  '......w..w......',
  '.....w....w.....',
  '................',
  '................',
  '................',
];

const LANTERN_WISP = spriteTile({
  name: 'Lantern wisp',
  filename: 'lantern-wisp.svg',
  high: COLOURS.nightHigh,
  low: COLOURS.nightLow,
  rows: WISP_ROWS,
  palette: { w: COLOURS.wispDark, W: COLOURS.wisp, F: COLOURS.flameHot },
});

const CRAWLER_ROWS = [
  '................',
  '................',
  '.l............l.',
  '.l............l.',
  '..l..cccccc..l..',
  '...lccccccccl...',
  '..lccEEccEEccl..',
  '.lcccccccccccl..',
  '.lcccccccccccl..',
  '..lcccccccccl...',
  '...l.cccccc.l...',
  '..l...cccc...l..',
  '.l...........l..',
  '................',
  '................',
  '................',
];

const CAVE_CRAWLER = spriteTile({
  name: 'Cave crawler',
  filename: 'cave-crawler.svg',
  high: COLOURS.nightHigh,
  low: COLOURS.nightLow,
  rows: CRAWLER_ROWS,
  palette: { c: COLOURS.crawler, l: COLOURS.crawlerDark, E: COLOURS.eye },
});

const PICKAXE_ROWS = [
  '................',
  '................',
  '.i............i.',
  '.iIi........iIi.',
  '..iIIiiiiiiIIi..',
  '..iIIIIIIIIIIi..',
  '...iiiihhiiii...',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '.......gg.......',
  '................',
  '................',
];

const WOODEN_PICKAXE = spriteTile({
  name: 'Wooden pickaxe',
  filename: 'wooden-pickaxe.svg',
  high: COLOURS.slateHigh,
  low: COLOURS.slateLow,
  rows: PICKAXE_ROWS,
  palette: {
    i: COLOURS.handleDark,
    I: COLOURS.planks,
    h: COLOURS.handle,
    g: COLOURS.handleDark,
  },
});

const SWORD_ROWS = [
  '.......ss.......',
  '......sSSs......',
  '......sSSs......',
  '......sSSs......',
  '......sSSs......',
  '......sSSs......',
  '......sSSs......',
  '......sSSs......',
  '......sSSs......',
  '....gggggggg....',
  '....gggggggg....',
  '.......hh.......',
  '.......hh.......',
  '.......hh.......',
  '......gggg......',
  '................',
];

const STONE_SWORD = spriteTile({
  name: 'Stone sword',
  filename: 'stone-sword.svg',
  high: COLOURS.slateHigh,
  low: COLOURS.slateLow,
  rows: SWORD_ROWS,
  palette: {
    s: COLOURS.stoneEdge,
    S: COLOURS.stoneBlade,
    g: COLOURS.handleDark,
    h: COLOURS.handle,
  },
});

const BUCKET_ROWS = [
  '................',
  '......iiii......',
  '.....i....i.....',
  '....i......i....',
  '....i......i....',
  '..iiiiiiiiiiii..',
  '..iIIIIIIIIIIi..',
  '..iIIIIIIIIIIi..',
  '...iIIIIIIIIi...',
  '...iIIIIIIIIi...',
  '....iIIIIIIi....',
  '....iIIIIIIi....',
  '.....iiiiii.....',
  '................',
  '................',
  '................',
];

const BUCKET = spriteTile({
  name: 'Bucket',
  filename: 'bucket.svg',
  high: COLOURS.slateHigh,
  low: COLOURS.slateLow,
  rows: BUCKET_ROWS,
  palette: { i: COLOURS.ironDark, I: COLOURS.iron },
});

/* --------------------------------------------------------------- audio --- */

interface WaveformRequest {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bars: number;
  readonly colour: string;
}

/** A row of blocky bars, which is what a sound looks like on a screen. */
function waveform(request: WaveformRequest): string {
  const { name, x, y, width, height, bars, colour } = request;
  const barWidth = width / (bars * 2 - 1);
  const parts: string[] = [];

  for (let bar = 0; bar < bars; bar += 1) {
    const barHeight = height * (0.25 + jitterFor(name, 0, bar) * 0.75);

    parts.push(
      [
        `<rect x="${String(x + bar * barWidth * 2)}"`,
        ` y="${String(y + (height - barHeight) / 2)}"`,
        ` width="${String(barWidth)}" height="${String(barHeight)}"`,
        ` rx="2" fill="${colour}"/>`,
      ].join(''),
    );
  }

  return parts.join('');
}

const BLOCK_BREAK_SET = tilePicture({
  name: 'Block break set',
  filename: 'block-break-set.svg',
  high: COLOURS.slateHigh,
  low: COLOURS.slateLow,
  standsOnGround: false,
  body: [
    isometricBlock({
      x: 128,
      y: 76,
      size: 50,
      name: 'break',
      top: COLOURS.stone,
      left: COLOURS.stoneDark,
      right: shadeOf(COLOURS.stoneDark, 0.85),
    }),
    waveform({
      name: 'block-break',
      x: 236,
      y: 92,
      width: 208,
      height: 86,
      bars: 13,
      colour: COLOURS.chalk,
    }),
  ].join(''),
});

/** The moon, as a game made of cubes would draw one. */
function pixelMoon(left: number, top: number, size: number): string {
  const crater = size / 8;
  const craters = [
    [2, 2, 2],
    [5, 4, 2],
    [3, 5, 1],
  ] as const;

  return [
    `<rect x="${String(left)}" y="${String(top)}" width="${String(size)}" height="${String(size)}" fill="${COLOURS.chalk}"/>`,
    ...craters.map(([across, down, span]) =>
      [
        `<rect x="${String(left + crater * across)}" y="${String(top + crater * down)}"`,
        ` width="${String(crater * span)}" height="${String(crater * span)}"`,
        ` fill="${shadeOf(COLOURS.chalk, 0.88)}"/>`,
      ].join(''),
    ),
  ].join('');
}

const NIGHT_AMBIENCE = tilePicture({
  name: 'Night ambience',
  filename: 'night-ambience.svg',
  high: COLOURS.nightHigh,
  low: COLOURS.nightLow,
  standsOnGround: false,
  body: [
    ...[
      [44, 54, 10],
      [88, 176, 8],
      [204, 40, 12],
      [386, 44, 8],
      [300, 214, 8],
    ].map(([left, top, size]) =>
      [
        `<rect x="${String(left)}" y="${String(top)}"`,
        ` width="${String(size)}" height="${String(size)}"`,
        ` fill="${COLOURS.chalk}" opacity="0.7"/>`,
      ].join(''),
    ),
    pixelMoon(88, 88, 88),
    waveform({
      name: 'night-ambience',
      x: 236,
      y: 88,
      width: 208,
      height: 94,
      bars: 13,
      colour: COLOURS.wisp,
    }),
  ].join(''),
});

/* ------------------------------------------------------- concept sheets --- */

const SHEET = { width: 640, height: 360 } as const;

function sheetHeading(title: string, standfirst: string): string {
  return [
    `<text x="40" y="56" font-family="${LETTERING}" font-size="22" font-weight="bold" fill="${COLOURS.chalk}">${title}</text>`,
    `<text x="40" y="76" font-family="${LETTERING}" font-size="12" fill="${COLOURS.caption}">${standfirst}</text>`,
  ].join('');
}

function sheetCaption(centreX: number, baseline: number, words: string): string {
  return [
    `<text x="${String(centreX)}" y="${String(baseline)}" font-family="${LETTERING}" font-size="12"`,
    ` fill="${COLOURS.caption}" text-anchor="middle">${words}</text>`,
  ].join('');
}

/**
 * The block atlas, laid out the way an artist lays one out.
 *
 * Sixteen squares of the same textures the blocks are drawn from, which is what
 * the card asking for the first sixteen blocks is actually asking for.
 */
const BLOCK_ATLAS_SHEET: DemoPicture = (() => {
  const swatches: readonly (readonly [string, string])[] = [
    ['Grass', COLOURS.grass],
    ['Dirt', COLOURS.dirt],
    ['Stone', COLOURS.stone],
    ['Cobble', COLOURS.cobble],
    ['Sand', COLOURS.sand],
    ['Gravel', COLOURS.gravel],
    ['Oak log', COLOURS.bark],
    ['Planks', COLOURS.planks],
    ['Leaves', COLOURS.leaves],
    ['Water', COLOURS.water],
    ['Iron ore', COLOURS.ironDark],
    ['Coal ore', '#4a4a52'],
    ['Glass', '#bfe6ff'],
    ['Wool', '#e8e8e8'],
    ['Brick', '#a4553f'],
    ['Torch', COLOURS.flame],
  ];

  // Eight across and two down rather than four and four: sixteen swatches in
  // four rows ran off the bottom of the sheet, and a contact sheet that cannot
  // show its last row is not a contact sheet.
  const cell = 58;
  const gap = 14;
  const columns = 8;
  const squares = 4;

  const drawn = swatches
    .map(([label, colour], index) => {
      const left = 40 + (index % columns) * (cell + gap);
      const top = 128 + Math.floor(index / columns) * (cell + 46);
      const pixels: string[] = [];

      for (let row = 0; row < squares; row += 1) {
        for (let column = 0; column < squares; column += 1) {
          const wander = (jitterFor(label, row, column) - 0.5) * 0.24;

          pixels.push(
            [
              `<rect x="${String(left + (column * cell) / squares)}"`,
              ` y="${String(top + (row * cell) / squares)}"`,
              ` width="${String(cell / squares)}" height="${String(cell / squares)}"`,
              ` fill="${shadeOf(colour, 1 + wander)}"/>`,
            ].join(''),
          );
        }
      }

      return `${pixels.join('')}${sheetCaption(left + cell / 2, top + cell + 14, label)}`;
    })
    .join('');

  return {
    name: 'Block atlas sheet',
    filename: 'block-atlas-sheet.svg',
    ...SHEET,
    svg: svgDocument({
      ...SHEET,
      title: 'Block atlas sheet',
      body: [
        `<rect width="${String(SHEET.width)}" height="${String(SHEET.height)}" fill="${COLOURS.paper}"/>`,
        sheetHeading('Block atlas — first sixteen', '16 × 16 each, one page, no mipmaps'),
        drawn,
      ].join(''),
    }),
  };
})();

/** The three sizes a slime splits into, which is what the card asks for. */
const SLIME_CONCEPT_SHEET: DemoPicture = (() => {
  const poses = [
    { scale: 1.4, centreX: 130, label: 'Large' },
    { scale: 0.95, centreX: 330, label: 'Medium' },
    { scale: 0.6, centreX: 500, label: 'Small' },
  ];

  const drawn = poses
    .map(({ scale, centreX, label }) => {
      const pixel = 8 * scale;
      const width = pixel * SLIME_ROWS.length;

      return [
        pixelSprite({
          rows: SLIME_ROWS,
          palette: SLIME_PALETTE,
          x: centreX - width / 2,
          y: 272 - width,
          pixel,
        }),
        sheetCaption(centreX, 302, label),
      ].join('');
    })
    .join('');

  return {
    name: 'Slime concept sheet',
    filename: 'slime-concept-sheet.svg',
    ...SHEET,
    svg: svgDocument({
      ...SHEET,
      title: 'Slime concept sheet',
      body: [
        `<rect width="${String(SHEET.width)}" height="${String(SHEET.height)}" fill="${COLOURS.slate}"/>`,
        sheetHeading(
          'Slime — splits in three',
          'Hit a large one and you have two mediums and a problem',
        ),
        `<line x1="40" y1="274" x2="600" y2="274" stroke="${COLOURS.rule}" stroke-width="2"/>`,
        drawn,
      ].join(''),
    }),
  };
})();

/* ------------------------------------------------------------- key art --- */

/**
 * The picture on the launcher tile.
 *
 * A tile with key art on it draws the picture and nothing else, so the name of
 * the game has to be in the picture.
 *
 * The island is a five-by-five field of columns drawn back to front. Every
 * square carries the block on top and the one under it; only the two edges
 * facing the viewer are drawn all the way down, because everything else is
 * behind something.
 */
export const DEMO_KEY_ART: DemoPicture = (() => {
  const width = 1280;
  const height = 720;
  const size = 52;
  const centreX = 640;
  const centreY = 200;

  /** How many blocks stand above the base at each square of the island. */
  const islandHeights = [
    [1, 1, 2, 1, 0],
    [1, 2, 2, 1, 1],
    [0, 1, 1, 1, 0],
    [1, 1, 1, 0, 0],
    [0, 1, 0, 0, 0],
  ];

  const treeRow = 2;
  const treeColumn = 1;

  interface StackedBlock {
    readonly row: number;
    readonly column: number;
    readonly level: number;
    readonly kind: 'grass' | 'dirt' | 'trunk' | 'leaves';
  }

  const stack: StackedBlock[] = [];

  islandHeights.forEach((columns, row) => {
    columns.forEach((stands, column) => {
      const isFacingUs = row === islandHeights.length - 1 || column === columns.length - 1;
      const lowest = isFacingUs ? -1 : stands - 1;

      for (let level = lowest; level <= stands; level += 1) {
        stack.push({ row, column, level, kind: level === stands ? 'grass' : 'dirt' });
      }
    });
  });

  // Two blocks of trunk under the canopy, so the tree reads as a tree rather
  // than as a darker patch of the hill it is standing on.
  stack.push({ row: treeRow, column: treeColumn, level: 2, kind: 'trunk' });
  stack.push({ row: treeRow, column: treeColumn, level: 3, kind: 'trunk' });
  stack.push({ row: treeRow, column: treeColumn, level: 4, kind: 'leaves' });
  stack.push({ row: treeRow - 1, column: treeColumn, level: 4, kind: 'leaves' });
  stack.push({ row: treeRow + 1, column: treeColumn, level: 4, kind: 'leaves' });
  stack.push({ row: treeRow, column: treeColumn - 1, level: 4, kind: 'leaves' });
  stack.push({ row: treeRow, column: treeColumn + 1, level: 4, kind: 'leaves' });

  const paints = {
    grass: {
      top: COLOURS.grass,
      left: COLOURS.dirt,
      right: COLOURS.dirtDark,
      fringe: COLOURS.grassDark,
    },
    dirt: {
      top: COLOURS.dirt,
      left: COLOURS.dirtDark,
      right: shadeOf(COLOURS.dirtDark, 0.82),
    },
    trunk: {
      top: COLOURS.barkTop,
      left: COLOURS.bark,
      right: shadeOf(COLOURS.bark, 0.8),
    },
    leaves: {
      top: COLOURS.leaves,
      left: shadeOf(COLOURS.leaves, 0.74),
      right: shadeOf(COLOURS.leaves, 0.6),
    },
  };

  // Back to front, which is the only order a picture of stacked cubes can be
  // drawn in: a square nearer the viewer has to cover the one behind it.
  const island = stack
    .sort((first, second) =>
      first.row + first.column === second.row + second.column
        ? first.level - second.level
        : first.row + first.column - (second.row + second.column),
    )
    .map((block) =>
      isometricBlock({
        x: centreX + (block.column - block.row) * size,
        y: centreY + ((block.column + block.row) * size) / 2 - block.level * size,
        size,
        name: `${block.kind}-${String(block.row)}-${String(block.column)}-${String(block.level)}`,
        tiles: 3,
        ...paints[block.kind],
      }),
    )
    .join('');

  const clouds = [
    { x: 140, y: 120, width: 200, height: 34 },
    { x: 980, y: 190, width: 160, height: 28 },
    { x: 300, y: 62, width: 120, height: 24 },
  ]
    .map((cloud) =>
      [
        `<rect x="${String(cloud.x)}" y="${String(cloud.y)}"`,
        ` width="${String(cloud.width)}" height="${String(cloud.height)}"`,
        ' fill="#ffffff" opacity="0.8"/>',
      ].join(''),
    )
    .join('');

  const title = (fill: string, dropped: number): string =>
    [
      `<text x="640" y="${String(650 + dropped)}" font-family="${LETTERING}"`,
      ' font-size="84" font-weight="bold" letter-spacing="12"',
      ` text-anchor="middle" fill="${fill}">BLOCKFALL</text>`,
    ].join('');

  return {
    name: 'Blockfall key art',
    filename: 'blockfall-key-art.svg',
    width,
    height,
    svg: svgDocument({
      width,
      height,
      title: 'Blockfall key art',
      body: [
        backdrop({ width, height, high: COLOURS.skyHigh, low: COLOURS.skyLow }),
        `<rect x="1020" y="72" width="80" height="80" fill="${COLOURS.flameHot}"/>`,
        clouds,
        island,
        // The same words twice, the darker one nudged down: an outline a font
        // does not have to support, on a picture that is mostly pale sky.
        title('#0f1626', 5),
        title('#f7f3e8', 0),
        `<text x="640" y="694" font-family="${LETTERING}" font-size="20" letter-spacing="8" text-anchor="middle" fill="#0f1626" opacity="0.75">DIG · BUILD · LAST THE NIGHT</text>`,
      ].join(''),
    }),
  };
})();

/** The square mark, which is what the project looks like where it is named. */
export const DEMO_LOGO: DemoPicture = (() => {
  const size = 256;

  return {
    name: 'Blockfall mark',
    filename: 'blockfall-mark.svg',
    width: size,
    height: size,
    svg: svgDocument({
      width: size,
      height: size,
      title: 'Blockfall mark',
      body: [
        `<rect width="${String(size)}" height="${String(size)}" rx="40" fill="#1d2333"/>`,
        isometricBlock({
          x: 128,
          y: 52,
          size: 72,
          name: 'mark',
          top: COLOURS.grass,
          left: COLOURS.dirt,
          right: COLOURS.dirtDark,
          fringe: COLOURS.grassDark,
        }),
      ].join(''),
    }),
  };
})();

/* ------------------------------------------------------------- avatars --- */

const FACE_ROWS = [
  '..hhhhhhhhhh..',
  '.hhhhhhhhhhhh.',
  'hhhhhhhhhhhhhh',
  'hhhhhhhhhhhhhh',
  'ssssssssssssss',
  'ssseessseeesss',
  'ssseessseeesss',
  'ssssssssssssss',
  'sssssmmmmsssss',
  'ssssssssssssss',
  '.ssssssssssss.',
  '..ssssssssss..',
];

interface AvatarRequest {
  /** Whose face it is: a teammate's initials, or `Owner`. */
  readonly named: string;
  readonly hair: string;
  readonly skin: string;
  readonly ground: string;
}

/**
 * A player head, which is what everybody's face is in a game like this.
 *
 * The people on the board are drawn as initials until they choose a picture, and
 * a demo where nobody has chosen one shows a row of monograms where a studio
 * would have faces.
 */
function avatarPicture({ named, hair, skin, ground }: AvatarRequest): DemoPicture {
  const size = 192;
  const pixel = 12;
  const columns = 14;

  return {
    name: `${named} avatar`,
    filename: `avatar-${named.toLowerCase()}.svg`,
    width: size,
    height: size,
    svg: svgDocument({
      width: size,
      height: size,
      title: `${named} avatar`,
      body: [
        `<rect width="${String(size)}" height="${String(size)}" fill="${ground}"/>`,
        pixelSprite({
          rows: FACE_ROWS,
          palette: { h: hair, s: skin, e: COLOURS.ink, m: shadeOf(skin, 0.75) },
          x: (size - columns * pixel) / 2,
          y: (size - FACE_ROWS.length * pixel) / 2,
          pixel,
        }),
      ].join(''),
    }),
  };
}

export interface DemoAvatar {
  /** Whose face it is, by the initials the fixture refers to people by. */
  readonly initials: string;
  readonly picture: DemoPicture;
}

export const DEMO_AVATARS: readonly DemoAvatar[] = [
  { named: 'LT', hair: '#2b2118', skin: '#d9a06b', ground: '#2f4858' },
  { named: 'DO', hair: '#1a1410', skin: '#8d5524', ground: '#3c3255' },
  { named: 'SB', hair: '#c0703a', skin: '#f0c39b', ground: '#28503f' },
  { named: 'JI', hair: '#221a14', skin: '#b47b4a', ground: '#4a3050' },
  { named: 'MK', hair: '#4a2f1c', skin: '#e2b48c', ground: '#3d4a2b' },
].map((person) => ({ initials: person.named, picture: avatarPicture(person) }));

/**
 * A face for whoever set the install up.
 *
 * They are on the demo as much as the seeded five are — every card and every
 * asset says they reported it — so an install where the only monogram left is
 * the owner's is a demo with one person missing from it. Given only when they
 * have not chosen a picture of their own, like everything else here.
 *
 * Its own ground colour, because the owner is not one of the five and a face
 * that repeats one of theirs reads as a duplicate.
 */
export const DEMO_OWNER_AVATAR: DemoPicture = avatarPicture({
  named: 'Owner',
  hair: '#38302a',
  skin: '#c98d5a',
  ground: '#5a3a2a',
});

/**
 * A picture for every asset in the library, matched to it by name.
 *
 * By name, as everything else the seed does is: an asset somebody has since
 * renamed keeps whatever picture it has, and a new one added to the fixture is
 * filed with its picture on the next run.
 */
export const DEMO_ASSET_PICTURES: readonly DemoPicture[] = [
  GRASS_BLOCK,
  STONE_AND_COBBLE,
  OAK_LOG_AND_PLANKS,
  SAND_AND_GRAVEL,
  TORCH,
  SLIME,
  LANTERN_WISP,
  CAVE_CRAWLER,
  WOODEN_PICKAXE,
  STONE_SWORD,
  BUCKET,
  BLOCK_BREAK_SET,
  NIGHT_AMBIENCE,
];

export interface DemoCardSheet {
  /** The card the sheet is attached to, by title. */
  readonly cardTitle: string;
  readonly picture: DemoPicture;
}

/**
 * The two cards that have something pinned to them.
 *
 * Two rather than eighteen: a board where every card carries an attachment is
 * not a board anybody has worked on, and the point of these is that the files
 * tab on a card has something in it to look at.
 */
export const DEMO_CARD_SHEETS: readonly DemoCardSheet[] = [
  { cardTitle: 'First sixteen blocks in the atlas', picture: BLOCK_ATLAS_SHEET },
  { cardTitle: 'Slime mob concept sheet', picture: SLIME_CONCEPT_SHEET },
];
