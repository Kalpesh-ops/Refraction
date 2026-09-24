import type { InputIntent, MatchSnapshot, Player, Relic, Runner } from '../types';

export const ARENA = { width: 960, height: 620, delayMs: 5000, durationMs: 180000 };
export const RUNNER_RADIUS = 19;
export const WALLS = [
  [190, 150, 170, 18],
  [600, 150, 170, 18],
  [190, 452, 170, 18],
  [600, 452, 170, 18],
  [382, 255, 196, 18],
  [382, 350, 196, 18],
];
export const PLAYER_COLORS = ['#46d5c6', '#ff9166', '#f2d46f', '#e08bff', '#6ca9ff', '#f28ab7'];
const SPAWNS = [[116, 110], [844, 110], [844, 510], [116, 510], [480, 110], [480, 510]];
const RELIC_SPAWNS = [[480, 205], [300, 310], [660, 310], [480, 430]];
const SHRINES = [[90, 310], [870, 310], [480, 80], [480, 540], [210, 230], [750, 390]];

export function hitsWall(x: number, y: number, r: number = RUNNER_RADIUS): boolean {
  for (const [wx, wy, w, h] of WALLS) {
    const closestX = clamp(x, wx, wx + w);
    const closestY = clamp(y, wy, wy + h);
    if (Math.hypot(x - closestX, y - closestY) < r) {
      return true;
    }
  }
  return false;
}

export function createSnapshot(players: Record<string, Player>, now: number): MatchSnapshot {
  const runners: Record<string, Runner> = {};
  Object.keys(players).forEach((id, index) => {
    const [x, y] = SPAWNS[index % SPAWNS.length];
    runners[id] = { id, slot: index, x, y, score: 0, carrying: false, dashReadyAt: now, trail: [{ x, y, at: now }] };
  });
  const relics: Record<string, Relic> = {};
  RELIC_SPAWNS.forEach(([x, y], index) => relics[`relic-${index}`] = { id: `relic-${index}`, x, y, active: true });
  return { startedAt: now, endsAt: now + ARENA.durationMs, runners, relics };
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const shrineFor = (runner: Runner) => SHRINES[runner.slot % SHRINES.length];

export function tick(snapshot: MatchSnapshot, inputs: Record<string, InputIntent>, now: number, dt: number): MatchSnapshot {
  const next: MatchSnapshot = structuredClone(snapshot);
  if (now >= next.endsAt) return { ...next, winnerId: winnerId(next) };
  const runners = Object.values(next.runners);
  for (const runner of runners) {
    const input = inputs[runner.id] ?? { x: 0, y: 0, dash: false, updatedAt: now };
    const length = Math.hypot(input.x, input.y) || 1;
    const speed = 165 * dt;
    const nx = clamp(runner.x + (input.x / length) * speed, 40, ARENA.width - 40);
    if (!hitsWall(nx, runner.y, RUNNER_RADIUS)) {
      runner.x = nx;
    }
    const ny = clamp(runner.y + (input.y / length) * speed, 40, ARENA.height - 40);
    if (!hitsWall(runner.x, ny, RUNNER_RADIUS)) {
      runner.y = ny;
    }
    const lastPoint = runner.trail[runner.trail.length - 1];
    if (!lastPoint || now - lastPoint.at >= 100) {
      runner.trail.push({ x: Math.round(runner.x), y: Math.round(runner.y), at: now });
    }
    runner.trail = runner.trail.filter(point => point.at >= now - ARENA.delayMs - 250);
    if (input.dash && now >= runner.dashReadyAt) {
      runner.dashReadyAt = now + 1700;
      for (const rival of runners) if (rival.id !== runner.id && distance(runner, rival) < 88) {
        if (rival.carrying) dropRelic(next, rival);
        const rx = clamp(rival.x + (rival.x - runner.x) * .45, 40, ARENA.width - 40);
        if (!hitsWall(rx, rival.y, RUNNER_RADIUS)) {
          rival.x = rx;
        }
        const ry = clamp(rival.y + (rival.y - runner.y) * .45, 40, ARENA.height - 40);
        if (!hitsWall(rival.x, ry, RUNNER_RADIUS)) {
          rival.y = ry;
        }
      }
    }
    const echo = runner.trail.find(point => point.at >= now - ARENA.delayMs) ?? runner.trail[0];
    for (const relic of Object.values(next.relics)) {
      if (relic.active && !runner.carrying && distance(runner, relic) < 32 && plateHeld(echo)) {
        relic.active = false; relic.carrierId = runner.id; runner.carrying = true;
      }
      if (relic.carrierId === runner.id) { relic.x = runner.x; relic.y = runner.y; }
    }
    const [sx, sy] = shrineFor(runner);
    if (runner.carrying && distance(runner, { x: sx, y: sy }) < 48) scoreRelic(next, runner, now);
  }
  return next;
}

function plateHeld(point: { x: number; y: number }) { return distance(point, { x: 480, y: 310 }) < 95 || distance(point, { x: 480, y: 210 }) < 45; }
function dropRelic(snapshot: MatchSnapshot, runner: Runner) {
  const relic = Object.values(snapshot.relics).find(item => item.carrierId === runner.id);
  if (relic) {
    delete relic.carrierId;
    relic.active = true;
    relic.x = runner.x;
    relic.y = runner.y;
  }
  runner.carrying = false;
}
function scoreRelic(snapshot: MatchSnapshot, runner: Runner, now: number) {
  const relic = Object.values(snapshot.relics).find(item => item.carrierId === runner.id);
  if (relic) {
    delete relic.carrierId;
    relic.active = true;
    const activeRelics = Object.values(snapshot.relics).filter(item => item.id !== relic.id && item.active);
    const freeSpawns = RELIC_SPAWNS.filter(([sx, sy]) =>
      activeRelics.every(item => distance(item, { x: sx, y: sy }) > 20)
    );
    const pool = freeSpawns.length > 0 ? freeSpawns : RELIC_SPAWNS;
    const spawn = pool[Math.floor(Math.random() * pool.length)];
    relic.x = spawn[0];
    relic.y = spawn[1];
  }
  runner.carrying = false;
  runner.score += 1;
}
export function winnerId(snapshot: MatchSnapshot) { return Object.values(snapshot.runners).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0]?.id; }
