import type { InputIntent, MatchSnapshot, Player, Relic, Runner } from '../types';

export const ARENA = { width: 960, height: 620, delayMs: 5000, durationMs: 180000 };
export const PLAYER_COLORS = ['#46d5c6', '#ff9166', '#f2d46f', '#e08bff', '#6ca9ff', '#f28ab7'];
const SPAWNS = [[116, 110], [844, 110], [844, 510], [116, 510], [480, 110], [480, 510]];
const RELIC_SPAWNS = [[480, 205], [300, 310], [660, 310], [480, 430]];
const SHRINES = [[90, 310], [870, 310], [480, 80], [480, 540], [210, 150], [750, 470]];

export function createSnapshot(players: Record<string, Player>, now: number): MatchSnapshot {
  const runners: Record<string, Runner> = {};
  Object.keys(players).forEach((id, index) => {
    const [x, y] = SPAWNS[index % SPAWNS.length];
    runners[id] = { id, x, y, score: 0, carrying: false, dashReadyAt: now, trail: [{ x, y, at: now }] };
  });
  const relics: Record<string, Relic> = {};
  RELIC_SPAWNS.forEach(([x, y], index) => relics[`relic-${index}`] = { id: `relic-${index}`, x, y, active: true });
  return { startedAt: now, endsAt: now + ARENA.durationMs, runners, relics };
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const shrineFor = (id: string) => SHRINES[Math.abs([...id].reduce((sum, c) => sum + c.charCodeAt(0), 0)) % SHRINES.length];

export function tick(snapshot: MatchSnapshot, inputs: Record<string, InputIntent>, now: number, dt: number): MatchSnapshot {
  const next: MatchSnapshot = structuredClone(snapshot);
  if (now >= next.endsAt) return { ...next, winnerId: winnerId(next) };
  const runners = Object.values(next.runners);
  for (const runner of runners) {
    const input = inputs[runner.id] ?? { x: 0, y: 0, dash: false, updatedAt: now };
    const length = Math.hypot(input.x, input.y) || 1;
    const speed = 165 * dt;
    runner.x = clamp(runner.x + (input.x / length) * speed, 40, ARENA.width - 40);
    runner.y = clamp(runner.y + (input.y / length) * speed, 40, ARENA.height - 40);
    runner.trail.push({ x: runner.x, y: runner.y, at: now });
    runner.trail = runner.trail.filter(point => point.at >= now - ARENA.delayMs - 250);
    if (input.dash && now >= runner.dashReadyAt) {
      runner.dashReadyAt = now + 1700;
      for (const rival of runners) if (rival.id !== runner.id && distance(runner, rival) < 88) {
        if (rival.carrying) dropRelic(next, rival);
        rival.x = clamp(rival.x + (rival.x - runner.x) * .45, 40, ARENA.width - 40);
        rival.y = clamp(rival.y + (rival.y - runner.y) * .45, 40, ARENA.height - 40);
      }
    }
    const echo = runner.trail.find(point => point.at >= now - ARENA.delayMs) ?? runner.trail[0];
    for (const relic of Object.values(next.relics)) {
      if (relic.active && !runner.carrying && distance(runner, relic) < 32 && plateHeld(echo)) {
        relic.active = false; relic.carrierId = runner.id; runner.carrying = true;
      }
      if (relic.carrierId === runner.id) { relic.x = runner.x; relic.y = runner.y; }
    }
    const [sx, sy] = shrineFor(runner.id);
    if (runner.carrying && distance(runner, { x: sx, y: sy }) < 48) scoreRelic(next, runner, now);
  }
  return next;
}

function plateHeld(point: { x: number; y: number }) { return distance(point, { x: 480, y: 310 }) < 95 || distance(point, { x: 480, y: 210 }) < 45; }
function dropRelic(snapshot: MatchSnapshot, runner: Runner) { const relic = Object.values(snapshot.relics).find(item => item.carrierId === runner.id); if (relic) { relic.carrierId = undefined; relic.active = true; relic.x = runner.x; relic.y = runner.y; } runner.carrying = false; }
function scoreRelic(snapshot: MatchSnapshot, runner: Runner, now: number) { const relic = Object.values(snapshot.relics).find(item => item.carrierId === runner.id); if (relic) { relic.carrierId = undefined; relic.active = true; const spawn = RELIC_SPAWNS[Math.floor(Math.random() * RELIC_SPAWNS.length)]; relic.x = spawn[0]; relic.y = spawn[1]; } runner.carrying = false; runner.score += 1; }
export function winnerId(snapshot: MatchSnapshot) { return Object.values(snapshot.runners).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))[0]?.id; }
