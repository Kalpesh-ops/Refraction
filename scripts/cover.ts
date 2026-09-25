// Renders the contest cover from the game's own art: npx tsx scripts/cover.ts
// Writes public/assets/refraction-cover.png (1920 x 1080). No browser needed: the art code only
// uses fillStyle and fillRect, so a tiny canvas stand-in collects the pixels.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const AW = 320;
const AH = 180;
const SCALE = 6;
const buf = new Uint8Array(AW * AH * 3);
const hex = (c: string) => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

// Minimal 2D context: enough for paintArena, drawing straight into `buf`.
function fakeCanvas() {
  const ctx = {
    fillStyle: '#000000',
    fillRect(x: number, y: number, w: number, h: number) {
      const [r, g, b] = hex(ctx.fillStyle);
      for (let yy = Math.max(0, y); yy < Math.min(AH, y + h); yy++) {
        for (let xx = Math.max(0, x); xx < Math.min(AW, x + w); xx++) {
          const i = (yy * AW + xx) * 3;
          buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
        }
      }
    },
  };
  return { width: 0, height: 0, getContext: () => ctx };
}
(globalThis as unknown as { document: unknown }).document = { createElement: () => fakeCanvas() };

const { paintArena } = await import('../src/art/floor');
const { P, keeperOf } = await import('../src/art/palette');
const { BRANDMARK, SHARD, beaconSprite, ghostSprite, keeperSprite } = await import('../src/art/sprites');
const { SHRINES, W, H } = await import('../src/game/constants');
const { blocked, pointAt, traceBolt } = await import('../src/game/geometry');
type SpriteDef = import('../src/art/sprites').SpriteDef;

paintArena();

const put = (x: number, y: number, c: string) => {
  if (x < 0 || y < 0 || x >= AW || y >= AH) return;
  const [r, g, b] = hex(c);
  const i = (y * AW + x) * 3;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
};
const blit = (def: SpriteDef, x: number, y: number, flip = false, scale = 1) => {
  const w = def.grid[0].length;
  def.grid.forEach((row, gy) => {
    for (let gx = 0; gx < row.length; gx++) {
      const c = def.colors[row[gx]];
      if (!c) continue;
      const sx = flip ? w - 1 - gx : gx;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(x + sx * scale + dx, y + gy * scale + dy, c);
    }
  });
};
const art = (v: number) => Math.floor(v / 4);

// ---- the scene, in world coordinates like the game ----
const A = { x: 0, y: 0, slot: 0, figure: 0 }; // Amber hooded, throwing the beam
const B = { slot: 2, figure: 2 }; // Verdigris diver, about to be caught
const C = { x: 860, y: 560, slot: 1, figure: 3 }; // Rust warden, carrying lenses home

// Find a beam from A that bounces once off brass, clear of the title and the prism, into open floor.
let beam = traceBolt(A.x, A.y, 0);
let hitAt: { x: number; y: number } | null = null;
search: for (const [ax, ay] of [[300, 470], [260, 560], [360, 620], [220, 420], [420, 540], [520, 420], [480, 640], [200, 330]]) {
  if (blocked({ x: ax, y: ay }, 22)) continue;
  for (let deg = 0; deg < 360; deg += 0.5) {
    const path = traceBolt(ax, ay, (deg * Math.PI) / 180);
    if (path.points.length < 3) continue;
    const first = path.cum[1];
    const b1 = path.points[1];
    if (first < 160 || first > 560 || b1.y < 260 || b1.y > H - 40 || b1.x < 40 || b1.x > W - 40 || Math.hypot(b1.x - W / 2, b1.y - H / 2) < 220) continue;
    if (path.cum[2] - first < 220) continue;
    const p = pointAt(path, first + 190);
    if (p.x < 200 || p.x > W - 200 || p.y < 240 || p.y > H - 140 || blocked(p, 22) || Math.hypot(p.x - W / 2, p.y - H / 2) < 220) continue;
    A.x = ax; A.y = ay; beam = path; hitAt = p;
    break search;
  }
}
if (!hitAt) throw new Error('no cover beam found');
const beamEnd = beam.cum[1] + 190;

// Lamplight: darken the hall, then leave pools around keepers, beacons and the beam.
const lights: Array<[number, number, number]> = [
  [A.x, A.y, 26], [hitAt.x, hitAt.y, 30], [C.x, C.y, 24],
  [SHRINES[0][0], SHRINES[0][1] - 20, 20], [SHRINES[1][0], SHRINES[1][1] - 20, 20], [SHRINES[2][0], SHRINES[2][1] - 20, 18],
];
for (let d = 0; d < beamEnd; d += 16) { const p = pointAt(beam, d); lights.push([p.x, p.y, 9]); }
const ink = hex(P.ink);
const bayer = [[0, 2], [3, 1]];
for (let y = 0; y < AH; y++) {
  for (let x = 0; x < AW; x++) {
    let lit = 0;
    for (const [lx, ly, r] of lights) {
      const d = Math.hypot(x - art(lx), y - art(ly)) / r;
      if (d < 0.6) lit = Math.max(lit, 1);
      else if (d < 1) lit = Math.max(lit, (bayer[y % 2][x % 2] + 0.5) / 4 < (1 - d) / 0.4 ? 1 : 0);
    }
    const k = lit ? 0 : 0.55;
    const i = (y * AW + x) * 3;
    for (let c = 0; c < 3; c++) buf[i + c] = Math.round(buf[i + c] * (1 - k) + ink[c] * k);
  }
}

// Beacons (top-middle is under the title plate).
[[0, 0], [1, 1], [2, 2]].forEach(([seat, slot]) => {
  const [x, y] = SHRINES[seat];
  blit(beaconSprite(slot, true), art(x) - 7, art(y + 8) - 16);
});

// Lenses on the floor, and two over the warden's head.
for (const [x, y] of [[520, 300], [700, 470], [980, 180], [430, 610], [1110, 420]]) if (!blocked({ x, y }, 20)) blit(SHARD, art(x) - 3, art(y) - 4);
for (let i = 0; i < 2; i++) { const cx = art(C.x) - 3 + i * 3; const cy = art(C.y) - 16; for (let yy = -1; yy < 3; yy++) for (let xx = -1; xx < 2; xx++) put(cx + xx, cy + yy, P.ink); put(cx, cy, P.lamp); put(cx, cy + 1, P.lamp); }

// Echoes trailing A and C along where they walked.
blit(ghostSprite(A.slot, A.figure), art(A.x - 70) - 7, art(A.y + 26) - 10);
blit(ghostSprite(C.slot, C.figure), art(C.x - 80) - 7, art(C.y - 30) - 10, true);

// The beam: cloak-coloured cells with a pale core, stepping along the bounce.
const cloak = keeperOf(A.slot).cloak;
for (let d = 16; d < beamEnd; d += 3) {
  const p = pointAt(beam, d);
  const x = art(p.x);
  const y = art(p.y);
  for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) put(x + xx, y + yy, cloak);
}
for (let d = 16; d < beamEnd; d += 2) { const p = pointAt(beam, d); put(art(p.x), art(p.y), P.lampL); }
const bounce = beam.points[1];
for (const [dx, dy] of [[-3, -2], [3, -3], [-2, 3], [4, 2], [0, -4]]) put(art(bounce.x) + dx, art(bounce.y) + dy, P.lampL);

// Keepers. The diver is knocked flat by the beam, with sparks around.
blit(keeperSprite(A.slot, 0, A.figure), art(A.x) - 7, art(A.y) - 10);
blit(keeperSprite(C.slot, 1, C.figure), art(C.x) - 7, art(C.y) - 10, true);
const flat = keeperSprite(B.slot, 0, B.figure);
const rotated: SpriteDef = { colors: flat.colors, grid: flat.grid[0].split('').map((_, x) => flat.grid.map((row) => row[x]).reverse().join('')) };
blit(rotated, art(hitAt.x) - 8, art(hitAt.y) - 6);
const sparks = [P.lampL, keeperOf(B.slot).cloak, P.parchment, P.lamp];
for (let i = 0; i < 18; i++) {
  const ang = i * 2.4;
  const r = 9 + (i % 4) * 3;
  put(art(hitAt.x) + Math.round(Math.cos(ang) * r), art(hitAt.y) + Math.round(Math.sin(ang) * r * 0.8), sparks[i % sparks.length]);
}

// ---- the title plate ----
const LETTERS: Record<string, string[]> = {
  R: ['xxxx.', 'x...x', 'x...x', 'xxxx.', 'x.x..', 'x..x.', 'x...x'],
  E: ['xxxxx', 'x....', 'x....', 'xxxx.', 'x....', 'x....', 'xxxxx'],
  F: ['xxxxx', 'x....', 'x....', 'xxxx.', 'x....', 'x....', 'x....'],
  A: ['.xxx.', 'x...x', 'x...x', 'xxxxx', 'x...x', 'x...x', 'x...x'],
  C: ['.xxxx', 'x....', 'x....', 'x....', 'x....', 'x....', '.xxxx'],
  T: ['xxxxx', '..x..', '..x..', '..x..', '..x..', '..x..', '..x..'],
  I: ['xxx', '.x.', '.x.', '.x.', '.x.', '.x.', 'xxx'],
  O: ['.xxx.', 'x...x', 'x...x', 'x...x', 'x...x', 'x...x', '.xxx.'],
  N: ['x...x', 'xx..x', 'x.x.x', 'x.x.x', 'x..xx', 'x...x', 'x...x'],
};
const word = 'REFRACTION';
const LS = 3;
const wordW = [...word].reduce((n, ch) => n + LETTERS[ch][0].length * LS + LS, -LS);
const markW = BRANDMARK.grid[0].length * 2;
const padX = 10;
const plateW = markW + 10 + wordW + padX * 2;
const plateH = 7 * LS + 16;
const px0 = Math.round((AW - plateW) / 2);
const py0 = 6;
for (let y = py0; y < py0 + plateH; y++) for (let x = px0; x < px0 + plateW; x++) put(x, y, P.parchment);
for (let x = px0; x < px0 + plateW; x++) { put(x, py0, P.ink); put(x, py0 + plateH - 1, P.ink); put(x, py0 + 2, P.ink); put(x, py0 + plateH - 3, P.ink); }
for (let y = py0; y < py0 + plateH; y++) { put(px0, y, P.ink); put(px0 + plateW - 1, y, P.ink); }
blit(BRANDMARK, px0 + padX, py0 + Math.round((plateH - 32) / 2), false, 2);
let lx = px0 + padX + markW + 10;
const ly = py0 + 8;
for (const ch of word) {
  const g = LETTERS[ch];
  g.forEach((row, gy) => { for (let gx = 0; gx < row.length; gx++) if (row[gx] === 'x') for (let dy = 0; dy < LS; dy++) for (let dx = 0; dx < LS; dx++) put(lx + gx * LS + dx, ly + gy * LS + dy, P.ink); });
  lx += g[0].length * LS + LS;
}

// ---- PNG out ----
const OW = AW * SCALE;
const OH = AH * SCALE;
const raw = Buffer.alloc((OW * 3 + 1) * OH);
for (let y = 0; y < OH; y++) {
  const row = y * (OW * 3 + 1);
  raw[row] = 0;
  for (let x = 0; x < OW; x++) {
    const s = (Math.floor(y / SCALE) * AW + Math.floor(x / SCALE)) * 3;
    raw.set(buf.subarray(s, s + 3), row + 1 + x * 3);
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(OW, 0); ihdr.writeUInt32BE(OH, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('../public/assets/refraction-cover.png', import.meta.url), png);
console.log(`wrote public/assets/refraction-cover.png ${OW}x${OH}, ${png.length} bytes`);
