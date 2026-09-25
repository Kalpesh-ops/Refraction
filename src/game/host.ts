import { H, SHRINES, TUNING, W } from './constants';
import { blocked, dist, resolveCircle, type Vec } from './geometry';

/** `born` is when the central prism cast it; it flies for castFlightMs and can't be taken mid-air. */
export interface Shard { x: number; y: number; born?: number; lockUid?: string; lockUntil?: number }

/** Host-owned shared state. Written to Firebase only when it changes. */
export interface ArenaState {
  shards: Record<string, Shard>;
  carry: Record<string, number>;
  score: Record<string, number>;
  stuns: Record<string, number>;
  nextId: number;
  lastSpawn: number;
  /** First keeper to bank winScore lenses. Set once; ends the round. */
  winner?: string;
}

export interface HostPlayer { x: number; y: number; stunnedUntil: number; slot: number }

export type HostEvent =
  | { type: 'pickup'; uid: string; x: number; y: number }
  | { type: 'bank'; uid: string; amount: number; x: number; y: number }
  | { type: 'win'; uid: string };

/** Few lenses on the floor at once, so they are worth fighting over. */
export const shardTarget = (players: number) => Math.min(8, players + 2);

export const CENTER: Vec = { x: W / 2, y: H / 2 };

/** A landing spot for a lens cast from the central prism: somewhere in the hall, clear of walls, shrines and other lenses. */
function castSpot(state: ArenaState, players: Vec[], rand: () => number): Vec | null {
  for (let tries = 0; tries < 40; tries++) {
    const angle = rand() * Math.PI * 2;
    const r = 130 + rand() * 330;
    const p = { x: CENTER.x + Math.cos(angle) * r * 1.45, y: CENTER.y + Math.sin(angle) * r * 0.78 };
    if (p.x < 50 || p.x > W - 50 || p.y < 50 || p.y > H - 50) continue;
    if (blocked(p, 26)) continue;
    if (SHRINES.some(([x, y]) => dist(p, { x, y }) < 130)) continue;
    if (Object.values(state.shards).some((s) => dist(p, s) < 90)) continue;
    if (players.some((q) => dist(p, q) < 70)) continue;
    return p;
  }
  return null;
}

export function createArenaState(uids: string[], now: number, rand: () => number = Math.random): ArenaState {
  const state: ArenaState = { shards: {}, carry: {}, score: {}, stuns: {}, nextId: 0, lastSpawn: now };
  for (const uid of uids) { state.carry[uid] = 0; state.score[uid] = 0; state.stuns[uid] = 0; }
  const count = shardTarget(uids.length);
  for (let i = 0; i < count; i++) {
    const p = castSpot(state, [], rand);
    if (p) state.shards[`s${state.nextId++}`] = { x: Math.round(p.x), y: Math.round(p.y) };
  }
  return state;
}

const landed = (s: Shard, now: number) => s.born === undefined || now - s.born >= TUNING.castFlightMs;

/** One host tick: pickups, banking, the win check and casting. Mutates state; returns events for effects. */
export function hostStep(state: ArenaState, players: Record<string, HostPlayer>, now: number, rand: () => number = Math.random): { changed: boolean; events: HostEvent[] } {
  let changed = false;
  const events: HostEvent[] = [];
  if (state.winner) return { changed, events };

  for (const [uid, p] of Object.entries(players)) {
    if (now < p.stunnedUntil) continue;
    for (const [id, shard] of Object.entries(state.shards)) {
      if ((state.carry[uid] ?? 0) >= TUNING.carryMax) break;
      if (!landed(shard, now)) continue;
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
      if (!state.winner && state.score[uid] >= TUNING.winScore) {
        state.winner = uid;
        events.push({ type: 'win', uid });
        return { changed, events };
      }
    }
  }

  const target = shardTarget(Object.keys(players).length);
  if (Object.keys(state.shards).length < target && now - state.lastSpawn >= TUNING.castEveryMs) {
    const p = castSpot(state, Object.values(players), rand);
    state.lastSpawn = now;
    if (p) {
      state.shards[`s${state.nextId++}`] = { x: Math.round(p.x), y: Math.round(p.y), born: now };
      changed = true;
    }
  }

  return { changed, events };
}

/**
 * A keeper reported being caught. They drop everything they carry, and one lens jumps out of their
 * beacon into the catcher's hands (or onto the floor if the catcher's hands are full).
 */
export function applyHit(state: ArenaState, victim: string, by: string, at: Vec, now: number): { dropped: number; stolen: boolean } {
  const dropped = state.carry[victim] ?? 0;
  state.carry[victim] = 0;
  const scatter = (i: number, n: number, lockUid?: string) => {
    const angle = (i / Math.max(1, n)) * Math.PI * 2 + 0.4;
    const p = resolveCircle({ x: at.x + Math.cos(angle) * 58, y: at.y + Math.sin(angle) * 58 }, 14);
    state.shards[`s${state.nextId++}`] = lockUid
      ? { x: Math.round(p.x), y: Math.round(p.y), lockUid, lockUntil: now + TUNING.dropLockMs }
      : { x: Math.round(p.x), y: Math.round(p.y) };
  };
  for (let i = 0; i < dropped; i++) scatter(i, dropped + 1, victim);

  let stolen = false;
  if (by !== victim) {
    state.stuns[by] = (state.stuns[by] ?? 0) + 1;
    if ((state.score[victim] ?? 0) > 0 && !state.winner) {
      state.score[victim] -= 1;
      stolen = true;
      if ((state.carry[by] ?? 0) < TUNING.carryMax) state.carry[by] = (state.carry[by] ?? 0) + 1;
      else scatter(dropped, dropped + 1);
    }
  }
  return { dropped, stolen };
}

/** Ranked results; the lighthouse-lighter is always first. `tie` only when time ran out on equal scores. */
export function standings(state: Pick<ArenaState, 'score' | 'winner'>, uids: string[]) {
  const ranked = [...uids].sort((a, b) =>
    Number(b === state.winner) - Number(a === state.winner) || (state.score[b] ?? 0) - (state.score[a] ?? 0) || a.localeCompare(b));
  const top = state.score[ranked[0]] ?? 0;
  const tie = !state.winner && ranked.length > 1 && (state.score[ranked[1]] ?? 0) === top;
  return { ranked, tie };
}

/** Firebase drops empty objects and undefined fields; restore the shape. */
export function normalizeState(raw: Partial<ArenaState> | null | undefined): ArenaState {
  const state: ArenaState = {
    shards: raw?.shards ?? {},
    carry: raw?.carry ?? {},
    score: raw?.score ?? {},
    stuns: raw?.stuns ?? {},
    nextId: raw?.nextId ?? 0,
    lastSpawn: raw?.lastSpawn ?? 0,
  };
  if (raw?.winner) state.winner = raw.winner;
  return state;
}
