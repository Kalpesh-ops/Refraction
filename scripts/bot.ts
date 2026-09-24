// Headless test guest: joins a room, moves, fires at the host, and reports hits it takes.
// Usage: npx tsx scripts/bot.ts <ROOM> [name]
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { get, getDatabase, onChildAdded, onValue, push, ref, set } from 'firebase/database';
import { readFileSync } from 'node:fs';
import { TUNING } from '../src/game/constants';
import { sweepHits, traceBolt, type BoltPath } from '../src/game/geometry';

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('=', 2) as [string, string]));
const app = initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, databaseURL: env.VITE_FIREBASE_DATABASE_URL, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID });
const db = getDatabase(app);
const code = process.argv[2];
const name = process.argv[3] ?? 'Bot';

const { user } = await signInAnonymously(getAuth(app));
const uid = user.uid;
let offset = 0;
onValue(ref(db, '.info/serverTimeOffset'), (s) => { offset = s.val() ?? 0; });
const now = () => Date.now() + offset;

const players = (await get(ref(db, `rooms/${code}/players`))).val() ?? {};
const used = new Set(Object.values(players).map((p: any) => p.slot));
let slot = 0; while (used.has(slot)) slot++;
await set(ref(db, `rooms/${code}/players/${uid}`), { id: uid, name, slot, joinedAt: Date.now(), connected: true });
console.log('joined', code, 'as', name, 'slot', slot, uid);

let match: any = null; let hostUid = ''; let status = '';
const hostPos: any = {};
onValue(ref(db, `rooms/${code}/match`), (s) => { match = s.val(); });
onValue(ref(db, `rooms/${code}/hostUid`), (s) => { hostUid = s.val(); });
onValue(ref(db, `rooms/${code}/status`), (s) => { const prev = status; status = s.val(); console.log('status', status); if (prev === 'playing' && status === 'results') setTimeout(() => process.exit(0), 1500); });
onValue(ref(db, `rooms/${code}/pos`), (s) => { Object.assign(hostPos, s.val() ?? {}); });
let lastScore = '';
onValue(ref(db, `rooms/${code}/state`), (s) => { const v = s.val(); const sc = JSON.stringify(v?.score ?? {}) + ' carry ' + JSON.stringify(v?.carry ?? {}); if (sc !== lastScore) { lastScore = sc; console.log('state', sc); } });

const bolts = new Map<string, { t0: number; path: BoltPath; checked: number; owner: string; echo: boolean }>();
onChildAdded(ref(db, `rooms/${code}/shots`), (s) => {
  const v = s.val(); if (v.o === uid) return;
  const path = traceBolt(v.x, v.y, v.a);
  bolts.set(s.key!, { t0: v.t, path, checked: 0, owner: v.o, echo: false });
  bolts.set(s.key! + '~e', { t0: v.t + TUNING.echoDelayMs, path, checked: 0, owner: v.o, echo: true });
});

let x = 900, y = 630, dir = 1, stunnedUntil = 0, immuneUntil = 0, lastFire = 0, hits = 0, lastLog = 0;
setInterval(() => {
  const t = now();
  const live = match && status === 'playing' && t >= match.startsAt && t < match.endsAt;
  if (!live) return;
  if (t >= stunnedUntil) { x += dir * TUNING.speed * 0.05 * 0.6; if (x > 1100 || x < 760) dir *= -1; }
  for (const [id, b] of bolts) {
    if (t < b.t0) continue;
    const d = Math.min(((t - b.t0) * TUNING.boltSpeed) / 1000, b.path.length);
    if (t >= immuneUntil && sweepHits(b.path, b.checked, d, { x, y }, TUNING.runnerRadius + TUNING.boltRadius)) {
      hits++; stunnedUntil = t + TUNING.stunMs; immuneUntil = t + TUNING.immuneMs;
      console.log(`HIT by ${b.echo ? 'echo' : 'bolt'} #${hits} at`, Math.round(x), Math.round(y));
      push(ref(db, `rooms/${code}/hits`), { v: uid, by: b.owner, sid: b.echo ? id.slice(0, -2) : id, echo: b.echo, x: Math.round(x), y: Math.round(y), t });
      bolts.delete(id); continue;
    }
    b.checked = d;
    if (d >= b.path.length) bolts.delete(id);
  }
  const target = hostPos[hostUid];
  const aim = target ? Math.atan2(target.y - y, target.x - x) : Math.PI;
  if (t >= stunnedUntil && t - lastFire > 1400 && target) {
    lastFire = t;
    push(ref(db, `rooms/${code}/shots`), { o: uid, x: Math.round(x), y: Math.round(y), a: Math.round(aim * 1000) / 1000, t });
  }
  set(ref(db, `rooms/${code}/pos/${uid}`), { x: Math.round(x * 10) / 10, y, a: Math.round(aim * 100) / 100, t, s: stunnedUntil });
  if (t - lastLog > 5000) { lastLog = t; console.log('tick', Math.round((match.endsAt - t) / 1000), 's left; host at', target && Math.round(target.x), target && Math.round(target.y)); }
}, 50);
