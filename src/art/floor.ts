import { H, OBSTACLES, SHRINES, W, type Segment } from '../game/constants';
import { P } from './palette';

/** World pixels per art pixel. Everything drawn in the arena snaps to this grid. */
export const ART = 4;
export const AW = W / ART;
export const AH = H / ART;

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function segDist(px: number, py: number, s: { ax: number; ay: number; bx: number; by: number }) {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / len2));
  return { d: Math.hypot(px - (s.ax + dx * t), py - (s.ay + dy * t)), t };
}

/** Paints the Lens Works floor, walls and beacon pads at art resolution (320 x 180). */
export function paintArena(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = AW;
  canvas.height = AH;
  const ctx = canvas.getContext('2d')!;
  const px = (x: number, y: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
  const rand = rng(1907);

  // Flagstones: 8 x 8 slabs, staggered every other row, each with its own tone and wear.
  const tones = [P.slate, P.slate, P.slate, P.slate2, P.ink2];
  for (let ty = 0; ty < AH / 8 + 1; ty++) {
    const shift = ty % 2 ? 4 : 0;
    for (let tx = -1; tx < AW / 8 + 1; tx++) {
      const x0 = tx * 8 + shift;
      const y0 = ty * 8;
      const tone = tones[Math.floor(rand() * tones.length)];
      ctx.fillStyle = tone;
      ctx.fillRect(x0, y0, 8, 8);
      ctx.fillStyle = P.ink2;
      ctx.fillRect(x0, y0, 8, 1);
      ctx.fillRect(x0, y0, 1, 8);
      if (tone !== P.ink2) px(x0 + 1, y0 + 1, P.slate2);
      const specks = Math.floor(rand() * 3);
      for (let i = 0; i < specks; i++) px(x0 + 2 + Math.floor(rand() * 5), y0 + 2 + Math.floor(rand() * 5), rand() < 0.5 ? P.slate2 : P.ink2);
      if (rand() < 0.12) {
        let cx = x0 + 2 + Math.floor(rand() * 4);
        let cy = y0 + 2;
        for (let i = 0; i < 5; i++) { px(cx, cy, P.ink); cx += rand() < 0.5 ? 1 : 0; cy += 1; }
      }
    }
  }

  // Moss creeping in from the corners and edges.
  for (let i = 0; i < 260; i++) {
    const edge = rand();
    const x = edge < 0.5 ? Math.floor(Math.pow(rand(), 2.2) * 60) : AW - 1 - Math.floor(Math.pow(rand(), 2.2) * 60);
    const y = rand() < 0.5 ? Math.floor(Math.pow(rand(), 1.6) * AH) : AH - 1 - Math.floor(Math.pow(rand(), 1.6) * AH);
    px(x, y, rand() < 0.7 ? P.moss : P.slate2);
  }

  // Brass compass inlay under the central prism.
  const cx = AW / 2;
  const cy = AH / 2;
  for (let y = 0; y < AH; y++) {
    for (let x = 0; x < AW; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (Math.abs(d - 27) < 0.55) px(x, y, P.brassD);
      if (Math.abs(d - 23) < 0.5 && (Math.floor(Math.atan2(y - cy, x - cx) * 12 / Math.PI) % 2 === 0)) px(x, y, P.brassD);
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    for (let r = 29; r < (i % 2 ? 33 : 38); r++) px(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), P.brassD);
  }

  // Beacon pads: a stone disc with a brass rim at every slot.
  for (const [sx, sy] of SHRINES) {
    const bx = sx / ART;
    const by = sy / ART;
    for (let y = Math.floor(by - 14); y <= by + 14; y++) {
      for (let x = Math.floor(bx - 14); x <= bx + 14; x++) {
        const d = Math.hypot(x + 0.5 - bx, y + 0.5 - by);
        if (d < 10.5) px(x, y, (x * 3 + y) % 7 === 0 ? P.slate : P.slate2);
        else if (d < 11.5) px(x, y, P.brassD);
        else if (d < 12.4 && (Math.floor(Math.atan2(y - by, x - bx) * 16 / Math.PI) % 2 === 0)) px(x, y, P.brassD);
      }
    }
  }

  // Walls, rasterised from the same segments the physics uses.
  for (const s of OBSTACLES) paintSegment(ctx, s);

  // Arena rim.
  ctx.fillStyle = P.ink;
  ctx.fillRect(0, 0, AW, 1); ctx.fillRect(0, AH - 1, AW, 1); ctx.fillRect(0, 0, 1, AH); ctx.fillRect(AW - 1, 0, 1, AH);
  ctx.fillStyle = P.brassD;
  ctx.fillRect(1, 1, AW - 2, 1); ctx.fillRect(1, AH - 2, AW - 2, 1); ctx.fillRect(1, 1, 1, AH - 2); ctx.fillRect(AW - 2, 1, 1, AH - 2);
  return canvas;
}

function paintSegment(ctx: CanvasRenderingContext2D, seg: Segment) {
  const s = { ax: seg.ax / ART, ay: seg.ay / ART, bx: seg.bx / ART, by: seg.by / ART };
  const mirror = seg.kind === 'mirror';
  const core = mirror ? 1.1 : seg.h / ART;
  const pad = core + (mirror ? 2.2 : 1.2);
  const x0 = Math.floor(Math.min(s.ax, s.bx) - pad - 1);
  const x1 = Math.ceil(Math.max(s.ax, s.bx) + pad + 1);
  const y0 = Math.floor(Math.min(s.ay, s.by) - pad - 1);
  const y1 = Math.ceil(Math.max(s.ay, s.by) + pad + 1);
  const len = Math.hypot(s.bx - s.ax, s.by - s.ay);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const { d, t } = segDist(x + 0.5, y + 0.5, s);
      let c: string | null = null;
      if (mirror) {
        const along = Math.floor(t * len);
        if (d <= 0.75) c = along % 5 === 1 ? P.lampL : along % 5 === 2 ? P.glassL : P.glass;
        else if (d <= 1.7) c = P.brass;
        else if (d <= pad) c = P.ink;
      } else if (d <= core) {
        const above = segDist(x + 0.5, y - 0.5, s).d > core;
        const mortar = y % 3 === 0 || (x + (Math.floor(y / 3) % 2) * 3) % 6 === 0;
        c = above ? P.stoneL : mortar ? P.ink2 : (x * 7 + y * 3) % 11 === 0 ? P.stoneL : P.stone;
      } else if (d <= pad) c = P.ink;
      if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
    }
  }
}
