import { H, SHRINES, TUNING, W } from './constants';
import { blocked, dist, resolveCircle, type Vec } from './geometry';

export interface Shard { x: number; y: number; lockUid?: string; lockUntil?: number }

/** Host-owned shared state. Written to Firebase only when it changes. */
export interface ArenaState {
  shards: Record<string, Shard>;
  carry: Record<string, number>;
  score: Record<string, number>;
  stuns: Record<string, number>;
  nextId: number;
  lastSpawn: number;
}

export interface HostPlayer { x: number; y: number; stunnedUntil: number; slot: number }

export type HostEvent =
  | { type: 'pickup'; uid: string; x: number; y: number }
  | { type: 'bank'; uid: string; amount: number; x: number; y: number };

export const shardTarget = (players: number) => Math.min(14, 5 + players * 2);

function freeSpot(state: ArenaState, players: Vec[], rand: () => number): Vec | null {
  for (let tries = 0; tries < 40; tries++) {
    const p = { x: 60 + rand() * (W - 120), y: 60 + rand() * (H - 120) };
    if (blocked(p, 26)) continue;
    if (SHRINES.some(([x, y]) => dist(p, { x, y }) < 120)) continue;
    if (Object.values(state.shards).some((s) => dist(p, s) < 70)) continue;
    if (players.some((q) => dist(p, q) < 90)) continue;
    return p;
  }
  return null;
}

export function createArenaState(uids: string[], now: number, rand: () => number = Math.random): ArenaState {
  const state: ArenaState = { shards: {}, carry: {}, score: {}, stuns: {}, nextId: 0, lastSpawn: now };
  for (const uid of uids) { state.carry[uid] = 0; state.score[uid] = 0; state.stuns[uid] = 0; }
  const count = shardTarget(uids.length);
  for (let i = 0; i < count; i++) {
    const p = freeSpot(state, [], rand);
    if (p) state.shards[`s${state.nextId++}`] = { x: Math.round(p.x), y: Math.round(p.y) };
  }
  return state;
}

/** One host tick: pickups, banking and respawns. Mutates state; returns events for effects. */
export function hostStep(state: ArenaState, players: Record<string, HostPlayer>, now: number, rand: () => number = Math.random): { changed: boolean; events: HostEvent[] } {
  let changed = false;
  const events: HostEvent[] = [];

  for (const [uid, p] of Object.entries(players)) {
    if (now < p.stunnedUntil) continue;
    for (const [id, shard] of Object.entries(state.shards)) {
      if ((state.carry[uid] ?? 0) >= TUNING.carryMax) break;
      if (shard.lockUid === uid && now < (shard.lockUntil ?? 0)) continue;
      if (dist(p, shard) < TUNING.pickupRadius) {
        delete state.shards[id];
        state.carry[uid] = (state.carry[uid] ?? 0) + 1;
        events.push({ type: 'pickup', uid, x: shard.x, y: shard.y });
        changed = true;
      }
    }
    const [sx, sy] = SHRINES[p.slot % SHRINES.length];
    const carrying = state.carry[uid] ?? 0;
    if (carrying > 0 && dist(p, { x: sx, y: sy }) < TUNING.shrineRadius) {
      state.score[uid] = (state.score[uid] ?? 0) + carrying;
      state.carry[uid] = 0;
      events.push({ type: 'bank', uid, amount: carrying, x: sx, y: sy });
      changed = true;
    }
  }

  const target = shardTarget(Object.keys(players).length);
  if (Object.keys(state.shards).length < target && now - state.lastSpawn > 900) {
    const p = freeSpot(state, Object.values(players), rand);
    state.lastSpawn = now;
    if (p) {
      state.shards[`s${state.nextId++}`] = { x: Math.round(p.x), y: Math.round(p.y) };
      changed = true;
    }
  }

  return { changed, events };
}

/** A player reported being hit: they drop everything they carry in a ring around them. */
export function applyHit(state: ArenaState, victim: string, by: string, at: Vec, now: number): number {
  const count = state.carry[victim] ?? 0;
  state.carry[victim] = 0;
  if (by !== victim) state.stuns[by] = (state.stuns[by] ?? 0) + 1;
  for (let i = 0; i < count; i++) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + 0.4;
    const p = resolveCircle({ x: at.x + Math.cos(angle) * 58, y: at.y + Math.sin(angle) * 58 }, 14);
    state.shards[`s${state.nextId++}`] = { x: Math.round(p.x), y: Math.round(p.y), lockUid: victim, lockUntil: now + TUNING.dropLockMs };
  }
  return count;
}

/** Ranked results; `tie` is true when the top two scores are equal. */
export function standings(state: Pick<ArenaState, 'score'>, uids: string[]) {
  const ranked = [...uids].sort((a, b) => (state.score[b] ?? 0) - (state.score[a] ?? 0) || a.localeCompare(b));
  const top = state.score[ranked[0]] ?? 0;
  const tie = ranked.length > 1 && (state.score[ranked[1]] ?? 0) === top;
  return { ranked, tie };
}

/** Firebase drops empty objects; restore the shape. */
export function normalizeState(raw: Partial<ArenaState> | null | undefined): ArenaState {
  return {
    shards: raw?.shards ?? {},
    carry: raw?.carry ?? {},
    score: raw?.score ?? {},
    stuns: raw?.stuns ?? {},
    nextId: raw?.nextId ?? 0,
    lastSpawn: raw?.lastSpawn ?? 0,
  };
}
