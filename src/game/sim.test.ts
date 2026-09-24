import { describe, expect, it } from 'vitest';
import { H, OBSTACLES, SHRINES, SPAWNS, TUNING, W } from './constants';
import { blocked, pointAt, resolveCircle, sweepHits, traceBolt } from './geometry';
import { applyHit, createArenaState, hostStep, normalizeState, shardTarget, standings } from './host';

const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

describe('map', () => {
  it('is point-symmetric', () => {
    for (const s of OBSTACLES) {
      expect(OBSTACLES.some((o) => Math.abs(o.ax - (W - s.ax)) < 1e-6 && Math.abs(o.ay - (H - s.ay)) < 1e-6 && o.kind === s.kind)).toBe(true);
    }
  });
  it('keeps spawns and shrines clear of walls', () => {
    for (const [x, y] of [...SPAWNS, ...SHRINES]) expect(blocked({ x, y }, TUNING.runnerRadius)).toBe(false);
  });
});

describe('movement collision', () => {
  it('pushes a runner out of a wall and keeps it in the arena', () => {
    const p = resolveCircle({ x: 320, y: 205 }, TUNING.runnerRadius);
    expect(blocked(p, TUNING.runnerRadius)).toBe(false);
    const edge = resolveCircle({ x: -50, y: 900 }, TUNING.runnerRadius);
    expect(edge.x).toBe(TUNING.runnerRadius);
    expect(edge.y).toBe(H - TUNING.runnerRadius);
  });
});

describe('bolts', () => {
  it('reflects off the arena border', () => {
    const path = traceBolt(640, 40, -Math.PI / 2);
    expect(path.points.length).toBeGreaterThan(2);
    expect(path.points[1].y).toBeCloseTo(0, 5);
    expect(path.points[2].y).toBeGreaterThan(path.points[1].y);
  });
  it('is absorbed by stone', () => {
    const path = traceBolt(320, 120, Math.PI / 2);
    expect(path.end).toBe('stone');
    expect(path.length).toBeLessThan(TUNING.boltRange);
  });
  it('never travels further than its range', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.37) expect(traceBolt(160, 148, a).length).toBeLessThanOrEqual(TUNING.boltRange + 1e-6);
  });
  it('is deterministic', () => {
    expect(traceBolt(300, 500, 0.8)).toEqual(traceBolt(300, 500, 0.8));
  });
  it('detects a sweep through a target', () => {
    const path = traceBolt(100, 360, 0);
    const target = pointAt(path, 80);
    expect(sweepHits(path, 60, 100, target, TUNING.runnerRadius)).toBe(true);
    expect(sweepHits(path, 0, 20, target, TUNING.runnerRadius)).toBe(false);
  });
});

describe('host rules', () => {
  const uids = ['a', 'b'];
  it('spawns the target shard count', () => {
    const s = createArenaState(uids, 0, seeded());
    expect(Object.keys(s.shards).length).toBe(shardTarget(2));
  });
  it('picks up a shard and banks it at the right shrine', () => {
    const s = createArenaState(uids, 0, seeded());
    const [id, shard] = Object.entries(s.shards)[0];
    hostStep(s, { a: { x: shard.x, y: shard.y, stunnedUntil: 0, slot: 0 } }, 1000, seeded(2));
    expect(s.carry.a).toBe(1);
    expect(s.shards[id]).toBeUndefined();
    const [sx, sy] = SHRINES[0];
    const { events } = hostStep(s, { a: { x: sx, y: sy, stunnedUntil: 0, slot: 0 } }, 1100, seeded(3));
    expect(s.score.a).toBe(1);
    expect(s.carry.a).toBe(0);
    expect(events.some((e) => e.type === 'bank')).toBe(true);
  });
  it('does not bank at a rival shrine', () => {
    const s = createArenaState(uids, 0, seeded());
    s.carry.a = 3;
    const [sx, sy] = SHRINES[1];
    hostStep(s, { a: { x: sx, y: sy, stunnedUntil: 0, slot: 0 } }, 1000, seeded());
    expect(s.score.a).toBe(0);
    expect(s.carry.a).toBe(3);
  });
  it('stunned runners cannot pick up', () => {
    const s = createArenaState(uids, 0, seeded());
    const shard = Object.values(s.shards)[0];
    hostStep(s, { a: { x: shard.x, y: shard.y, stunnedUntil: 5000, slot: 0 } }, 1000, seeded());
    expect(s.carry.a).toBe(0);
  });
  it('caps carried shards', () => {
    const s = createArenaState(uids, 0, seeded());
    s.carry.a = TUNING.carryMax;
    const shard = Object.values(s.shards)[0];
    hostStep(s, { a: { x: shard.x, y: shard.y, stunnedUntil: 0, slot: 0 } }, 1000, seeded());
    expect(s.carry.a).toBe(TUNING.carryMax);
  });
  it('drops carried shards on hit, locked to the victim for a moment', () => {
    const s = createArenaState(uids, 0, seeded());
    s.shards = {};
    s.carry.b = 3;
    expect(applyHit(s, 'b', 'a', { x: 640, y: 600 }, 1000)).toBe(3);
    expect(s.carry.b).toBe(0);
    expect(s.stuns.a).toBe(1);
    const dropped = Object.values(s.shards);
    expect(dropped).toHaveLength(3);
    const first = dropped[0];
    hostStep(s, { b: { x: first.x, y: first.y, stunnedUntil: 0, slot: 1 } }, 1500, seeded());
    expect(s.carry.b).toBe(0);
    hostStep(s, { b: { x: first.x, y: first.y, stunnedUntil: 0, slot: 1 } }, 1000 + TUNING.dropLockMs + 1, seeded());
    expect(s.carry.b).toBeGreaterThan(0);
  });
  it('ranks by score and reports ties', () => {
    expect(standings({ score: { a: 2, b: 5 } }, uids)).toEqual({ ranked: ['b', 'a'], tie: false });
    expect(standings({ score: { a: 3, b: 3 } }, uids).tie).toBe(true);
  });
  it('restores empty collections dropped by Firebase', () => {
    expect(normalizeState({ nextId: 4 })).toMatchObject({ shards: {}, carry: {}, score: {}, nextId: 4 });
  });
});
