import { describe, expect, it } from 'vitest';
import { ARENA, createSnapshot, tick, winnerId } from './engine';
import type { Player } from '../types';

const players: Record<string, Player> = {
  a: { id: 'a', name: 'Aster', color: '#46d5c6', joinedAt: 0, connected: true },
  b: { id: 'b', name: 'Briar', color: '#ff9166', joinedAt: 0, connected: true },
};

describe('Refraction engine', () => {
  it('creates a runner and a three-minute round for every player', () => {
    const state = createSnapshot(players, 1000);
    expect(Object.keys(state.runners)).toHaveLength(2);
    expect(state.endsAt - state.startedAt).toBe(ARENA.durationMs);
  });
  it('records a delayed reflection trail while moving', () => {
    const state = createSnapshot(players, 1000);
    const next = tick(state, { a: { x: 1, y: 0, dash: false, updatedAt: 1050 } }, 1050, .05);
    expect(next.runners.a.x).toBeGreaterThan(state.runners.a.x);
    expect(next.runners.a.trail.length).toBeGreaterThan(1);
  });
  it('ends a round with the highest scoring runner as winner', () => {
    const state = createSnapshot(players, 1000);
    state.runners.b.score = 2;
    const finished = tick(state, {}, state.endsAt + 1, .05);
    expect(finished.winnerId).toBe('b');
    expect(winnerId(finished)).toBe('b');
  });
});
