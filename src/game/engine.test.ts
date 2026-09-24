import { describe, expect, it } from 'vitest';
import { ARENA, createSnapshot, shrineFor, tick, winnerId } from './engine';
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
    const next = tick(state, { a: { x: 1, y: 0, dash: false, updatedAt: 1100 } }, 1100, .1);
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
  it('clears carrierId from relics and sets runner score to 1 after scoring', () => {
    const state = createSnapshot(players, 1000);
    const runner = state.runners.a;
    const relic = state.relics['relic-0'];
    runner.carrying = true;
    relic.carrierId = runner.id;
    const [sx, sy] = shrineFor(runner);
    runner.x = sx;
    runner.y = sy;

    const next = tick(state, {}, 1050, 0.05);

    expect(next.runners.a.score).toBe(1);
    for (const r of Object.values(next.relics)) {
      expect('carrierId' in r).toBe(false);
    }
  });
  it('gives 2 runners distinct slots and distinct shrineFor() results', () => {
    const state = createSnapshot(players, 1000);
    const [runnerA, runnerB] = Object.values(state.runners);
    expect(runnerA.slot).not.toBe(runnerB.slot);
    expect(shrineFor(runnerA)).not.toEqual(shrineFor(runnerB));
  });
  it('adds only one trail point when tick is called twice 50ms apart', () => {
    const state = createSnapshot(players, 1000);
    const initialTrailLength = state.runners.a.trail.length;

    const tick1 = tick(state, {}, 1050, 0.05);
    const tick2 = tick(tick1, {}, 1100, 0.05);

    expect(tick1.runners.a.trail.length).toBe(initialTrailLength);
    expect(tick2.runners.a.trail.length).toBe(initialTrailLength + 1);
  });
});
