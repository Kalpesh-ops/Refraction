export const W = 1280;
export const H = 720;

export const TUNING = {
  runnerRadius: 18,
  speed: 235,
  carrySlowdown: 0.07,
  boltSpeed: 780,
  boltRange: 1500,
  boltRadius: 6,
  maxBounces: 5,
  fireCooldownMs: 430,
  echoDelayMs: 3000,
  stunMs: 1400,
  immuneMs: 2300,
  knockback: 260,
  carryMax: 5,
  shardRadius: 12,
  pickupRadius: 32,
  shrineRadius: 48,
  dropLockMs: 2000,
  roundMs: 180_000,
  winScore: 10,
  castEveryMs: 3000,
  castFlightMs: 700,
  countdownMs: 3500,
  interpDelayMs: 110,
};

export type Surface = 'mirror' | 'stone';
export interface Segment { ax: number; ay: number; bx: number; by: number; h: number; kind: Surface }

const seg = (ax: number, ay: number, bx: number, by: number, h: number, kind: Surface): Segment => ({ ax, ay, bx, by, h, kind });

// Half of the arena. The other half is its point reflection through the centre, so every slot has the same map.
const HALF: Segment[] = [
  seg(250, 205, 390, 205, 13, 'stone'),
  seg(250, 205, 250, 265, 13, 'stone'),
  seg(470, 110, 545, 185, 5, 'mirror'),
  seg(215, 360, 215, 470, 5, 'mirror'),
  seg(430, 330, 430, 400, 24, 'stone'),
  seg(505, 575, 580, 500, 5, 'mirror'),
  seg(545, 165, 595, 165, 11, 'stone'),
  seg(685, 165, 735, 165, 11, 'stone'),
  seg(640, 292, 708, 360, 5, 'mirror'),
  seg(708, 360, 640, 428, 5, 'mirror'),
];

const flip = (s: Segment): Segment => seg(W - s.ax, H - s.ay, W - s.bx, H - s.by, s.h, s.kind);

export const OBSTACLES: Segment[] = [...HALF, ...HALF.map(flip)];

// Arena edge: bolts bounce off it.
export const BORDER: Segment[] = [
  seg(0, 0, W, 0, 0, 'mirror'),
  seg(W, 0, W, H, 0, 'mirror'),
  seg(W, H, 0, H, 0, 'mirror'),
  seg(0, H, 0, 0, 0, 'mirror'),
];

// Point-symmetric pairs: slot 0 faces slot 1, 2 faces 3, 4 faces 5.
export const SHRINES: Array<[number, number]> = [
  [95, 95], [W - 95, H - 95], [W - 95, 95], [95, H - 95], [640, 62], [640, H - 62],
];

export const SPAWNS: Array<[number, number]> = SHRINES.map(([x, y]) => [x + (640 - x) * 0.12, y + (360 - y) * 0.2]);
