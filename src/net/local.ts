import { serverNow } from '../firebase';
import { SHRINES, SPAWNS, TUNING } from '../game/constants';
import { dist, resolveCircle, sweepHits, traceBolt, type BoltPath } from '../game/geometry';
import { applyHit, createArenaState, hostStep, type ArenaState, type HostPlayer } from '../game/host';
import type { Hit, Match, Player, PosSample, RoomMeta, Shot } from '../types';
import { SessionExtras, type GameSession, type SessionKind } from './types';

const BOT_NAMES = ['Ivo', 'Mara', 'Tamsin', 'Oren', 'Wren'];

interface Bot {
  id: string; slot: number; name: string;
  x: number; y: number; a: number; vx: number; vy: number;
  stunnedUntil: number; immuneUntil: number; lastFire: number; gap: number;
  wanderUntil: number; wanderAngle: number; slowSince: number;
}

interface TrackedBolt { t0: number; path: BoltPath; checked: number; owner: string; echo: boolean; done: boolean; sid: string }

/**
 * A room that lives entirely in this tab: practice against bots, or the self-playing demo on the
 * landing page. It speaks the same GameSession interface as an online room, so the arena is identical.
 */
export class LocalSession implements GameSession {
  readonly uid: string;
  readonly code: string;
  meta: RoomMeta;
  missing = false;
  state: ArenaState;
  version = 0;
  readonly positions = new Map<string, PosSample[]>();
  localPos?: PosSample;
  onShot?: (id: string, shot: Shot) => void;
  onHit?: (id: string, hit: Hit) => void;

  private readonly listeners = new Set<() => void>();
  private readonly extras = new SessionExtras(() => this.bump());
  private bots: Bot[] = [];
  private bolts = new Map<string, TrackedBolt>();
  private timer = 0;
  private seq = 0;
  private last = 0;
  private readonly easy: boolean;

  constructor(readonly kind: Exclude<SessionKind, 'online'>, humanName?: string) {
    this.easy = kind === 'practice';
    this.uid = humanName ? 'you' : 'viewer';
    this.code = kind === 'practice' ? 'PRACTICE' : 'DEMO';
    const players: Record<string, Player> = {};
    if (humanName) players[this.uid] = { id: this.uid, name: humanName, slot: 0, joinedAt: 0, connected: true };
    const botCount = kind === 'practice' ? 2 : 3;
    for (let i = 0; i < botCount; i++) {
      const slot = humanName ? i + 1 : i;
      const id = `bot-${i}`;
      players[id] = { id, name: BOT_NAMES[i], slot, joinedAt: 0, connected: true };
    }
    this.meta = { code: this.code, hostUid: this.uid, status: 'playing', createdAt: Date.now(), players };
    this.state = createArenaState([], 0);
    this.newRound(0);
    this.timer = window.setInterval(() => this.tick(), 50);
  }

  get feed() { return this.extras.feed; }
  get flags() { return this.extras.flags; }
  pushFeed(text: string, slot: number) { this.extras.pushFeed(text, slot); }
  flag(name: string) { this.extras.flag(name); }
  get isHost() { return true; }
  get status() { return this.meta.status; }
  get match(): Match | undefined { return this.meta.match; }
  slotOf(uid: string) { return this.meta.players[uid]?.slot ?? 0; }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private bump() { this.version++; this.listeners.forEach((fn) => fn()); }

  private newRound(round: number) {
    const now = serverNow();
    const lead = this.kind === 'practice' ? 2500 : 600;
    const length = this.kind === 'practice' ? 15 * 60_000 : 75_000;
    this.meta = { ...this.meta, status: 'playing', match: { round, startsAt: now + lead, endsAt: now + lead + length } };
    this.state = createArenaState(Object.keys(this.meta.players), now);
    this.bolts.clear();
    this.positions.clear();
    this.bots = Object.values(this.meta.players).filter((p) => p.id !== this.uid).map((p) => {
      const [x, y] = SPAWNS[p.slot];
      return { id: p.id, slot: p.slot, name: p.name, x, y, a: Math.atan2(360 - y, 640 - x), vx: 0, vy: 0, stunnedUntil: 0, immuneUntil: 0, lastFire: now + Math.random() * 1500, gap: 1500, wanderUntil: 0, wanderAngle: 0, slowSince: 0 };
    });
    this.bump();
  }

  publishPos(sample: PosSample) { this.localPos = sample; }

  fire(shot: Omit<Shot, 'o'>) {
    const id = `s${this.seq++}`;
    this.track(id, { ...shot, o: this.uid });
    return id;
  }

  private track(id: string, shot: Shot) {
    const path = traceBolt(shot.x, shot.y, shot.a);
    this.bolts.set(id, { t0: shot.t, path, checked: 0, owner: shot.o, echo: false, done: false, sid: id });
    this.bolts.set(`${id}~e`, { t0: shot.t + TUNING.echoDelayMs, path, checked: 0, owner: shot.o, echo: true, done: false, sid: id });
  }

  reportHit(hit: Omit<Hit, 'v'>) {
    applyHit(this.state, this.uid, hit.by, hit, serverNow());
    const b = this.bolts.get(hit.echo ? `${hit.sid}~e` : hit.sid);
    if (b) b.done = true;
    this.state = structuredClone(this.state);
    this.bump();
  }

  async start() { this.newRound((this.meta.match?.round ?? 0) + 1); }
  async backToLobby() { this.newRound((this.meta.match?.round ?? 0) + 1); }
  async leave() { this.dispose(); }
  dispose() { window.clearInterval(this.timer); this.listeners.clear(); }

  private tick() {
    const match = this.meta.match!;
    const now = serverNow();
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    if (this.meta.status === 'results') return;
    if (now >= match.endsAt) { this.newRound(match.round + 1); return; }
    const live = now >= match.startsAt;
    let changed = false;

    // Practice bots hold fire until you've learned to bank, or a minute has passed.
    const botsMayFire = this.kind === 'demo' || this.flags.has('banked') || now - match.startsAt > 60_000;

    for (const bot of this.bots) {
      if (live) this.steer(bot, now, dt);
      if (live && botsMayFire) this.maybeFire(bot, now);

      for (const b of this.bolts.values()) {
        if (b.done || b.owner === bot.id || now < b.t0) continue;
        const d = Math.min(((now - b.t0) * TUNING.boltSpeed) / 1000, b.path.length);
        if (now >= bot.immuneUntil && sweepHits(b.path, b.checked, d, bot, TUNING.runnerRadius + TUNING.boltRadius)) {
          b.done = true;
          bot.stunnedUntil = now + TUNING.stunMs;
          bot.immuneUntil = now + TUNING.immuneMs;
          const k = TUNING.knockback / Math.max(1, dist(bot, b.path.points[0]));
          bot.vx = (bot.x - b.path.points[0].x) * k;
          bot.vy = (bot.y - b.path.points[0].y) * k;
          applyHit(this.state, bot.id, b.owner, bot, now);
          changed = true;
          const hit: Hit = { v: bot.id, by: b.owner, sid: b.sid, echo: b.echo, x: Math.round(bot.x), y: Math.round(bot.y), t: now };
          this.onHit?.(`h${this.seq++}`, hit);
          if (b.owner === this.uid) this.flag('stunned');
        }
      }

      const buf = this.positions.get(bot.id) ?? [];
      buf.push({ x: Math.round(bot.x * 10) / 10, y: Math.round(bot.y * 10) / 10, a: bot.a, t: now, s: bot.stunnedUntil });
      while (buf.length > 2 && buf[0].t < now - TUNING.echoDelayMs - 1500) buf.shift();
      this.positions.set(bot.id, buf);
    }

    for (const [id, b] of this.bolts) {
      b.checked = Math.min(((now - b.t0) * TUNING.boltSpeed) / 1000, b.path.length);
      if (now > b.t0 + (b.path.length / TUNING.boltSpeed) * 1000 + 500) this.bolts.delete(id);
    }

    if (live) {
      const players: Record<string, HostPlayer> = {};
      for (const bot of this.bots) players[bot.id] = { x: bot.x, y: bot.y, stunnedUntil: bot.stunnedUntil, slot: bot.slot };
      if (this.localPos && this.uid in this.state.score) players[this.uid] = { x: this.localPos.x, y: this.localPos.y, stunnedUntil: this.localPos.s, slot: this.slotOf(this.uid) };
      const step = hostStep(this.state, players, now);
      for (const e of step.events) {
        if (e.uid === this.uid) this.flag(e.type === 'bank' ? 'banked' : 'picked');
      }
      changed ||= step.changed;
    }

    if (this.state.winner) {
      this.meta = { ...this.meta, status: 'results' };
      changed = true;
      if (this.kind === 'demo') window.setTimeout(() => this.newRound(match.round + 1), 4000);
    }
    if (changed) { this.state = structuredClone(this.state); this.bump(); }
  }

  private steer(bot: Bot, now: number, dt: number) {
    const carry = this.state.carry[bot.id] ?? 0;
    const [bx, by] = SHRINES[bot.slot];
    const remaining = this.meta.match!.endsAt - now;
    let target: { x: number; y: number } = { x: 640, y: 360 };
    if (carry >= (this.easy ? 2 : 3) || (carry > 0 && remaining < 12_000)) target = { x: bx, y: by };
    else {
      let best = Infinity;
      for (const shard of Object.values(this.state.shards)) {
        if (shard.lockUid === bot.id && now < (shard.lockUntil ?? 0)) continue;
        const d = dist(bot, shard);
        if (d < best) { best = d; target = shard; }
      }
    }
    let angle = Math.atan2(target.y - bot.y, target.x - bot.x);
    if (now < bot.wanderUntil) angle = bot.wanderAngle;
    const stunned = now < bot.stunnedUntil;
    const speed = stunned ? 0 : TUNING.speed * (this.easy ? 0.55 : 0.82) * (1 - carry * TUNING.carrySlowdown);
    const before = { x: bot.x, y: bot.y };
    bot.x += Math.cos(angle) * speed * dt + bot.vx * dt;
    bot.y += Math.sin(angle) * speed * dt + bot.vy * dt;
    const decay = Math.exp(-7 * dt);
    bot.vx *= decay;
    bot.vy *= decay;
    const p = resolveCircle(bot, TUNING.runnerRadius);
    bot.x = p.x;
    bot.y = p.y;
    // Stuck on a wall: wander sideways for a moment.
    if (!stunned && speed > 0 && dist(before, bot) < speed * dt * 0.35) {
      if (!bot.slowSince) bot.slowSince = now;
      if (now - bot.slowSince > 350) { bot.wanderUntil = now + 700; bot.wanderAngle = angle + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + Math.random()); bot.slowSince = 0; }
    } else bot.slowSince = 0;
    if (!stunned) bot.a = angle;
  }

  private maybeFire(bot: Bot, now: number) {
    if (now < bot.stunnedUntil || now - bot.lastFire < bot.gap) return;
    let foe: { x: number; y: number } | null = null;
    let best = this.easy ? 520 : 680;
    for (const [uid, p] of this.targets()) {
      if (uid === bot.id) continue;
      const d = dist(bot, p);
      if (d < best) { best = d; foe = p; }
    }
    if (!foe) return;
    const error = (Math.random() - 0.5) * (this.easy ? 0.7 : 0.24);
    const a = Math.atan2(foe.y - bot.y, foe.x - bot.x) + error;
    bot.a = a;
    bot.lastFire = now;
    bot.gap = (this.easy ? 2000 : 1100) + Math.random() * 900;
    const shot: Shot = { o: bot.id, x: Math.round(bot.x), y: Math.round(bot.y), a: Math.round(a * 1000) / 1000, t: now };
    const id = `s${this.seq++}`;
    this.track(id, shot);
    this.onShot?.(id, shot);
  }

  private *targets(): Generator<[string, { x: number; y: number }]> {
    for (const b of this.bots) yield [b.id, b];
    if (this.localPos && this.uid in this.state.score) yield [this.uid, this.localPos];
  }
}
