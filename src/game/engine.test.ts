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
  it('prevents a runner moving down from penetrating the wall at (382, 255, 196, 18)', () => {
    let state = createSnapshot(players, 1000);
    state.runners.a.x = 480;
    state.runners.a.y = 230;

    for (let i = 1; i <= 20; i++) {
      const now = 1000 + i * 50;
      state = tick(state, { a: { x: 0, y: 1, dash: false, updatedAt: now } }, now, 0.05);
      expect(state.runners.a.y + 19 > 255).toBe(false);
      expect(state.runners.a.x).toBeGreaterThanOrEqual(382);
      expect(state.runners.a.x).toBeLessThanOrEqual(578);
    }

    expect(state.runners.a.y + 19 > 255).toBe(false);
    expect(state.runners.a.x).toBeGreaterThanOrEqual(382);
    expect(state.runners.a.x).toBeLessThanOrEqual(578);
  });
  it('blocks relic pickup when runner echo is not on a plate', () => {
    const state = createSnapshot(players, 10000);
    const runner = state.runners.a;
    const relic = state.relics['relic-0'];
    runner.x = relic.x;
    runner.y = relic.y;
    runner.trail = [{ x: 116, y: 110, at: 10000 - ARENA.delayMs }];

    const next = tick(state, {}, 10000, 0.05);

    expect(next.runners.a.carrying).toBe(false);
    expect(next.relics['relic-0'].active).toBe(true);
    expect('carrierId' in next.relics['relic-0']).toBe(false);
  });
  it('allows relic pickup when runner echo from 5+ seconds ago is on plate center (480, 310)', () => {
    const state = createSnapshot(players, 10000);
    const runner = state.runners.a;
    const relic = state.relics['relic-0'];
    runner.x = relic.x;
    runner.y = relic.y;
    runner.trail = [{ x: 480, y: 310, at: 10000 - ARENA.delayMs }];

    const next = tick(state, {}, 10000, 0.05);

    expect(next.runners.a.carrying).toBe(true);
    expect(next.relics['relic-0'].active).toBe(false);
    expect(next.relics['relic-0'].carrierId).toBe('a');
  });
  it('drops rival relic and resets rival carrying when dashed within 88px', () => {
    const now = 2000;
    const state = createSnapshot(players, now);
    state.runners.a.x = 200;
    state.runners.a.y = 200;
    state.runners.a.dashReadyAt = now;

    state.runners.b.x = 230;
    state.runners.b.y = 200;
    state.runners.b.carrying = true;

    const relic = state.relics['relic-0'];
    relic.active = false;
    relic.carrierId = 'b';
    relic.x = 230;
    relic.y = 200;

    const next = tick(state, { a: { x: 0, y: 0, dash: true, updatedAt: now } }, now, 0.05);

    expect(next.runners.b.carrying).toBe(false);
    expect(next.relics['relic-0'].active).toBe(true);
    expect('carrierId' in next.relics['relic-0']).toBe(false);
    expect(next.relics['relic-0'].x).toBe(230);
    expect(next.relics['relic-0'].y).toBe(200);
    expect(next.runners.a.dashReadyAt).toBe(now + 1700);
  });
  it('prevents dash during cooldown 100ms after a dash', () => {
    const now = 2000;
    const state = createSnapshot(players, now);
    state.runners.a.dashReadyAt = now;
    state.runners.b.x = state.runners.a.x + 30;
    state.runners.b.y = state.runners.a.y;
    state.runners.b.carrying = true;

    const relic = state.relics['relic-0'];
    relic.active = false;
    relic.carrierId = 'b';
    relic.x = state.runners.b.x;
    relic.y = state.runners.b.y;

    const afterFirstDash = tick(state, { a: { x: 0, y: 0, dash: true, updatedAt: now } }, now, 0.05);
    expect(afterFirstDash.runners.a.dashReadyAt).toBe(now + 1700);

    afterFirstDash.runners.b.carrying = true;
    afterFirstDash.relics['relic-1'].active = false;
    afterFirstDash.relics['relic-1'].carrierId = 'b';
    const bPosBeforeSecondDash = { x: afterFirstDash.runners.b.x, y: afterFirstDash.runners.b.y };

    const afterSecondDash = tick(afterFirstDash, { a: { x: 0, y: 0, dash: true, updatedAt: now + 100 } }, now + 100, 0.05);

    expect(afterSecondDash.runners.a.dashReadyAt).toBe(now + 1700);
    expect(afterSecondDash.runners.b.carrying).toBe(true);
    expect(afterSecondDash.relics['relic-1'].active).toBe(false);
    expect(afterSecondDash.runners.b.x).toBe(bPosBeforeSecondDash.x);
    expect(afterSecondDash.runners.b.y).toBe(bPosBeforeSecondDash.y);
  });
  it('returns winnerId and does not move runners when now >= endsAt', () => {
    const state = createSnapshot(players, 1000);
    const startX = state.runners.a.x;
    const startY = state.runners.a.y;

    const finished = tick(state, { a: { x: 1, y: 1, dash: false, updatedAt: state.endsAt } }, state.endsAt, 0.05);

    expect(finished.winnerId).toBeDefined();
    expect(finished.runners.a.x).toBe(startX);
    expect(finished.runners.a.y).toBe(startY);
  });
  it('breaks score ties in favor of the lexicographically smaller id', () => {
    const state = createSnapshot(players, 1000);
    state.runners.a.score = 3;
    state.runners.b.score = 3;

    expect(winnerId(state)).toBe('a');

    const finished = tick(state, {}, state.endsAt + 1, 0.05);
    expect(finished.winnerId).toBe('a');
  });
  it('ensures no two active relics share a position after scoring', () => {
    for (let i = 0; i < 20; i++) {
      const state = createSnapshot(players, 1000);
      const runner = state.runners.a;
      const relic = state.relics['relic-0'];
      runner.carrying = true;
      relic.active = false;
      relic.carrierId = runner.id;
      const [sx, sy] = shrineFor(runner);
      runner.x = sx;
      runner.y = sy;

      const next = tick(state, {}, 1050, 0.05);

      const activeList = Object.values(next.relics).filter(r => r.active);
      expect(activeList.length).toBe(4);
      for (let j = 0; j < activeList.length; j++) {
        for (let k = j + 1; k < activeList.length; k++) {
          const r1 = activeList[j];
          const r2 = activeList[k];
          expect(r1.x === r2.x && r1.y === r2.y).toBe(false);
          expect(Math.hypot(r1.x - r2.x, r1.y - r2.y)).toBeGreaterThan(20);
        }
      }
    }
  });
});
