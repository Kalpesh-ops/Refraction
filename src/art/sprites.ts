import { KEEPERS, P, keeperOf, type Keeper } from './palette';

/** A sprite is rows of characters; `.` is transparent, every other character maps to a colour. */
export type Grid = string[];
export type ColorMap = Record<string, string>;

export interface SpriteDef { grid: Grid; colors: ColorMap }

// ---------------- keeper (16 x 16) ----------------

const KEEPER_A: Grid = [
  '....kkkkk.......',
  '...kcccccck.....',
  '..kccccccffk....',
  '..kcccccfefk....',
  '..kcccccfffk....',
  '..kdccccckk.....',
  '.kdcccccccck....',
  '.kdcccccccckfb..',
  '.kdcccccccckkbk.',
  '.kdcccccccckklk.',
  '.kdcccccccckklk.',
  '.kddccccccckkbk.',
  '..kddcccccck....',
  '..kddddddddk....',
  '...kk....kk.....',
  '................',
];

const KEEPER_B: Grid = [...KEEPER_A.slice(0, 13), '..kddddddddk....', '....kk..kk......', '................'];

export const keeperColors = (k: Keeper): ColorMap => ({
  k: P.ink, c: k.cloak, d: k.shade, f: P.skin, e: P.ink, b: P.brass, l: P.lampL,
});

export const keeperSprite = (slot: number, frame: 0 | 1 = 0): SpriteDef => ({ grid: frame ? KEEPER_B : KEEPER_A, colors: keeperColors(keeperOf(slot)) });

/** The echo: same silhouette, dithered and pale, so it reads as "not really there". */
export function ghostSprite(slot: number): SpriteDef {
  const grid = KEEPER_A.map((row, y) => [...row].map((ch, x) => {
    if (ch === '.') return '.';
    if (ch === 'k') return 'g';
    if (ch === 'l') return 'l';
    return (x + y) % 2 === 0 ? 'h' : '.';
  }).join(''));
  const k = keeperOf(slot);
  return { grid, colors: { g: k.ghost, h: k.ghost, l: P.lampL } };
}

// ---------------- lens shard (7 x 9) ----------------

export const SHARD: SpriteDef = {
  grid: [
    '...k...',
    '..kwk..',
    '.kwgsk.',
    '.kwgsk.',
    'kwggssk',
    '.kggsk.',
    '.kgssk.',
    '..ksk..',
    '...k...',
  ],
  colors: { k: P.ink, w: P.lampL, g: P.lamp, s: P.brass },
};

// ---------------- beacon (14 x 18) ----------------

const BEACON_GRID: Grid = [
  '.....kkkk.....',
  '....kbbbbk....',
  '...kbbbbbbk...',
  '...kkkkkkkk...',
  '...kgppppgk...',
  '...kgpllpgk...',
  '...kgpllpgk...',
  '...kgppppgk...',
  '...kkkkkkkk...',
  '....kbbbbk....',
  '.....kbbk.....',
  '.....kbbk.....',
  '.....kbbk.....',
  '....kbbbbk....',
  '..kkkkkkkkkk..',
  '..ksssssssSk..',
  '..ksSsssSssk..',
  '..kkkkkkkkkk..',
];

export function beaconSprite(slot: number, lit: boolean): SpriteDef {
  const k = keeperOf(slot);
  return {
    grid: BEACON_GRID,
    colors: { k: P.ink, b: P.brass, g: P.glass, p: lit ? k.cloak : k.shade, l: lit ? P.lampL : k.shade, s: P.stoneL, S: P.stone },
  };
}

// ---------------- manual icons ----------------

export const MIRROR_ICON: SpriteDef = (() => {
  const n = 12;
  const rows = Array.from({ length: n }, () => Array(n).fill('.'));
  for (let i = 0; i < n; i++) {
    const x = n - 1 - i;
    rows[i][x] = 'k';
    if (x - 1 >= 0) rows[i][x - 1] = 'b';
    if (x - 2 >= 0) rows[i][x - 2] = 'g';
    if (x - 3 >= 0) rows[i][x - 3] = i % 4 === 1 ? 'w' : 'g';
    if (x - 4 >= 0) rows[i][x - 4] = 'b';
    if (x - 5 >= 0) rows[i][x - 5] = 'k';
  }
  return { grid: rows.map((r) => r.join('')), colors: { k: P.ink, b: P.brass, g: P.glass, w: P.glassL } };
})();

export const STONE_ICON: SpriteDef = {
  grid: [
    'kkkkkkkkkkkk',
    'kSSSSSkSSSSk',
    'kssssskssssk',
    'kkkkkkkkkkkk',
    'kSSkSSSSSSSk',
    'kssksssssssk',
    'kkkkkkkkkkkk',
  ],
  colors: { k: P.ink, S: P.stoneL, s: P.stone },
};

// ---------------- brandmark (24 x 16) ----------------

/** One beam enters the prism and leaves as two: the shot, and the echo that follows it. */
export const BRANDMARK: SpriteDef = (() => {
  const w = 24;
  const h = 16;
  const g = Array.from({ length: h }, () => Array(w).fill('.'));
  const left = (y: number) => 12 - (Math.round((y - 1) * 0.55) + 1);
  const right = (y: number) => 11 + (Math.round((y - 1) * 0.55) + 1);
  for (let y = 1; y <= 13; y++) {
    for (let x = left(y); x <= right(y); x++) g[y][x] = x === left(y) || x === right(y) || y === 13 || y === 1 ? 'k' : 'g';
    if (y > 2 && y < 13) g[y][left(y) + 1] = 'h';
  }
  const set = (x: number, y: number, c: string) => { if (x >= 0 && x < w && y >= 0 && y < h && g[y][x] !== 'k') g[y][x] = c; };
  for (let x = 0; x < left(9); x++) g[9][x] = 'y';
  for (let x = left(9) + 1; x <= 12; x++) set(x, 9, 'l');
  set(13, 8, 'l'); set(14, 8, 'l'); set(15, 7, 'l');
  set(13, 10, 'l'); set(14, 10, 'l'); set(15, 11, 'l'); set(16, 11, 'l'); set(17, 11, 'l');
  for (let x = right(7) + 1; x < w; x++) g[7][x] = 'y';
  for (let x = right(11) + 1; x < w; x++) if (x % 2 === 0) g[11][x] = 'e';
  return { grid: g.map((r) => r.join('')), colors: { k: P.ink, g: P.glass, h: P.glassL, y: P.lamp, l: P.lampL, e: P.brass } };
})();

// ---------------- rendering helpers ----------------

export function spriteSize(def: SpriteDef) { return { w: def.grid[0].length, h: def.grid.length }; }

/** Paints a sprite into a new canvas at `scale` device pixels per art pixel. */
export function paintCanvas(def: SpriteDef, scale = 1, flip = false): HTMLCanvasElement {
  const { w, h } = spriteSize(def);
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  def.grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = def.colors[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect((flip ? w - 1 - x : x) * scale, y * scale, scale, scale);
    }
  });
  return canvas;
}

/** Horizontal runs of one colour, for compact SVG output. */
export function runs(def: SpriteDef) {
  const out: Array<{ x: number; y: number; w: number; color: string }> = [];
  def.grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      const color = def.colors[ch];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (color) out.push({ x, y, w: end - x, color });
      x = end;
    }
  });
  return out;
}

export function svgMarkup(def: SpriteDef, scale = 1) {
  const { w, h } = spriteSize(def);
  const rects = runs(def).map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="1" fill="${r.color}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges">${rects}</svg>`;
}

export const ALL_SLOTS = KEEPERS.map((_, i) => i);
