import { BORDER, H, OBSTACLES, TUNING, W, type Segment, type Surface } from './constants';

export interface Vec { x: number; y: number }

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function closestOnSegment(p: Vec, s: Segment): Vec {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - s.ax) * dx + (p.y - s.ay) * dy) / len2, 0, 1);
  return { x: s.ax + dx * t, y: s.ay + dy * t };
}

/** Pushes a circle out of every obstacle and keeps it inside the arena. Movement slides along walls. */
export function resolveCircle(p: Vec, r: number, obstacles: Segment[] = OBSTACLES): Vec {
  let { x, y } = p;
  for (let pass = 0; pass < 3; pass++) {
    for (const s of obstacles) {
      const c = closestOnSegment({ x, y }, s);
      const d = Math.hypot(x - c.x, y - c.y);
      const min = r + s.h;
      if (d < min) {
        const nx = d > 1e-6 ? (x - c.x) / d : 0;
        const ny = d > 1e-6 ? (y - c.y) / d : -1;
        x = c.x + nx * min;
        y = c.y + ny * min;
      }
    }
    x = clamp(x, r, W - r);
    y = clamp(y, r, H - r);
  }
  return { x, y };
}

export function blocked(p: Vec, r: number) {
  const q = resolveCircle(p, r);
  return Math.abs(q.x - p.x) > 0.5 || Math.abs(q.y - p.y) > 0.5;
}

export interface BoltPath {
  points: Vec[];
  /** Cumulative distance at each point. */
  cum: number[];
  length: number;
  /** Surface the bolt ended on, or null when it ran out of range. */
  end: Surface | null;
}

/**
 * Traces a bolt from (x, y) along angle. Mirrors reflect it, stone absorbs it.
 * Deterministic, so every client computes the same path from the same shot.
 */
export function traceBolt(x: number, y: number, angle: number): BoltPath {
  const pad = TUNING.boltRadius;
  const segments = [...OBSTACLES, ...BORDER];
  const points: Vec[] = [{ x, y }];
  const cum = [0];
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let ox = x;
  let oy = y;
  let remaining = TUNING.boltRange;
  let end: Surface | null = null;

  for (let bounce = 0; bounce <= TUNING.maxBounces; bounce++) {
    let bestT = Infinity;
    let best: { s: Segment; nx: number; ny: number } | null = null;
    for (const s of segments) {
      // Offset the segment toward the bolt's side by its thickness, so the bolt reflects off the visible surface.
      const sx = s.bx - s.ax;
      const sy = s.by - s.ay;
      const len = Math.hypot(sx, sy) || 1;
      let nx = -sy / len;
      let ny = sx / len;
      const side = (ox - s.ax) * nx + (oy - s.ay) * ny;
      if (side < 0) { nx = -nx; ny = -ny; }
      const off = s.h + (s.h > 0 ? pad : 0);
      const ax = s.ax + nx * off;
      const ay = s.ay + ny * off;
      const denom = dx * sy - dy * sx;
      if (Math.abs(denom) < 1e-9) continue;
      const t = ((ax - ox) * sy - (ay - oy) * sx) / denom;
      const u = ((ax - ox) * dy - (ay - oy) * dx) / denom;
      if (t > 1e-4 && u >= 0 && u <= 1 && t < bestT && dx * nx + dy * ny < 0) {
        bestT = t;
        best = { s, nx, ny };
      }
    }

    if (!best || bestT >= remaining) {
      ox += dx * remaining;
      oy += dy * remaining;
      points.push({ x: ox, y: oy });
      cum.push(cum[cum.length - 1] + remaining);
      break;
    }

    ox += dx * bestT;
    oy += dy * bestT;
    remaining -= bestT;
    points.push({ x: ox, y: oy });
    cum.push(cum[cum.length - 1] + bestT);

    if (best.s.kind === 'stone' || bounce === TUNING.maxBounces) {
      end = best.s.kind;
      break;
    }
    const dot = dx * best.nx + dy * best.ny;
    dx -= 2 * dot * best.nx;
    dy -= 2 * dot * best.ny;
    end = 'mirror';
  }

  return { points, cum, length: cum[cum.length - 1], end };
}

export function pointAt(path: BoltPath, d: number): Vec {
  const t = clamp(d, 0, path.length);
  for (let i = 1; i < path.cum.length; i++) {
    if (t <= path.cum[i]) {
      const a = path.points[i - 1];
      const b = path.points[i];
      const span = path.cum[i] - path.cum[i - 1] || 1;
      const k = (t - path.cum[i - 1]) / span;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return path.points[path.points.length - 1];
}

/** Returns true when the part of the bolt between distances d0 and d1 passes within r of c. */
export function sweepHits(path: BoltPath, d0: number, d1: number, c: Vec, r: number): boolean {
  const from = clamp(d0, 0, path.length);
  const to = clamp(d1, 0, path.length);
  if (to <= from) return false;
  const step = 5;
  for (let d = from; d < to + step; d += step) {
    if (dist(pointAt(path, Math.min(d, to)), c) < r) return true;
  }
  return false;
}
