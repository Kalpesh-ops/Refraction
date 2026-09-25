import { get, onChildAdded, onDisconnect, onValue, push, ref, set, update, type Database, type Unsubscribe } from 'firebase/database';
import { firebaseClient, serverNow } from '../firebase';
import { TUNING } from '../game/constants';
import { applyHit, createArenaState, hostStep, normalizeState, type ArenaState, type HostEvent, type HostPlayer } from '../game/host';
import type { Hit, Look, Match, Player, PosSample, RoomMeta, RoomSettings, RoomStatus, Shot } from '../types';
import { SessionExtras, type GameSession } from './types';

// Letters only, minus the ones the pixel font makes easy to misread (B/8, I/1, O/0, Q, S/5, Z/2).
const ROOM_CODE_ALPHABET = 'ACDEFGHJKLMNPRTUVWXY';
const MAX_PLAYERS = 6;
const POS_BUFFER_MS = TUNING.echoDelayMs + 1500;

const generateCode = () => Array.from({ length: 5 }, () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]).join('');
const freeSlot = (players: Record<string, Player>, preferred = -1) => {
  const used = new Set(Object.values(players).map((p) => p.slot));
  if (preferred >= 0 && preferred < MAX_PLAYERS && !used.has(preferred)) return preferred;
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return -1;
};


type Listener = () => void;

/**
 * One live connection to a room. Realtime data (positions, shots, hits) is kept in plain fields the
 * Phaser scene reads every frame; React only re-renders on `version` changes (meta and shared state).
 */
export class Session implements GameSession {
  readonly kind = 'online' as const;
  readonly uid: string;
  readonly code: string;
  meta: RoomMeta | null = null;
  missing = false;
  state: ArenaState = normalizeState(null);
  version = 0;
  /** Remote position history per player, oldest first. */
  readonly positions = new Map<string, PosSample[]>();
  onShot?: (id: string, shot: Shot) => void;
  onHit?: (id: string, hit: Hit) => void;
  onHostEvents?: (events: HostEvent[]) => void;

  private readonly db: Database;
  private readonly unsubs: Unsubscribe[] = [];
  private readonly listeners = new Set<Listener>();
  private readonly seenShots = new Set<string>();
  private readonly pendingHits: Array<[string, Hit]> = [];
  private readonly processedHits = new Set<string>();
  private hostTimer = 0;
  private lastPosWrite = 0;
  private lastPos?: PosSample;

  private readonly extras = new SessionExtras(() => this.bump());
  get feed() { return this.extras.feed; }
  get flags() { return this.extras.flags; }
  pushFeed(text: string, slot: number) { this.extras.pushFeed(text, slot); }
  flag(name: string) { this.extras.flag(name); }

  private constructor(db: Database, uid: string, code: string) {
    this.db = db;
    this.uid = uid;
    this.code = code;
  }

  static async create(name: string, look: Look = { slot: 0, figure: 0 }) {
    const client = await firebaseClient();
    let code = generateCode();
    for (let i = 0; i < 6; i++) {
      if (!(await get(ref(client.db, `rooms/${code}/hostUid`))).exists()) break;
      code = generateCode();
    }
    const player: Player = { id: client.uid, name, slot: freeSlot({}, look.slot), figure: look.figure, joinedAt: Date.now(), connected: true };
    const meta: RoomMeta = { code, hostUid: client.uid, status: 'lobby', createdAt: Date.now(), players: { [client.uid]: player } };
    await set(ref(client.db, `rooms/${code}`), meta);
    return new Session(client.db, client.uid, code).connect();
  }

  static async join(code: string, name: string, look: Look = { slot: -1, figure: 0 }) {
    const client = await firebaseClient();
    const [hostSnap, playersSnap, statusSnap] = await Promise.all([
      get(ref(client.db, `rooms/${code}/hostUid`)),
      get(ref(client.db, `rooms/${code}/players`)),
      get(ref(client.db, `rooms/${code}/status`)),
    ]);
    if (!hostSnap.exists()) throw new Error('Room not found. Check the code.');
    const players = (playersSnap.val() ?? {}) as Record<string, Player>;
    const existing = players[client.uid];
    if (existing) {
      await update(ref(client.db, `rooms/${code}/players/${client.uid}`), { name, connected: true });
    } else {
      if (statusSnap.val() !== 'lobby') throw new Error('That match already started. Wait for the next round.');
      const slot = freeSlot(players, look.slot);
      if (slot < 0) throw new Error('That room is full.');
      const player: Player = { id: client.uid, name, slot, figure: look.figure, joinedAt: Date.now(), connected: true };
      await set(ref(client.db, `rooms/${code}/players/${client.uid}`), player);
    }
    return new Session(client.db, client.uid, code).connect();
  }

  private path(p = '') { return ref(this.db, `rooms/${this.code}${p ? `/${p}` : ''}`); }

  private connect() {
    const meta: Partial<RoomMeta> = { code: this.code };
    const emitMeta = () => {
      if (!meta.hostUid) { this.missing = true; this.meta = null; }
      else { this.missing = false; this.meta = { ...(meta as RoomMeta), players: meta.players ?? {} }; }
      this.syncHostLoop();
      this.bump();
    };
    let loaded = 0;
    const field = <K extends keyof RoomMeta>(key: K) => this.unsubs.push(onValue(this.path(key), (snap) => {
      meta[key] = (snap.val() ?? undefined) as RoomMeta[K];
      if (++loaded >= 6) emitMeta();
    }));
    // `loaded` counts initial loads so the first emit waits for every field.
    field('hostUid'); field('status'); field('createdAt'); field('players'); field('match'); field('settings');

    this.unsubs.push(onValue(this.path('state'), (snap) => {
      this.state = normalizeState(snap.val());
      this.bump();
    }));

    this.unsubs.push(onValue(this.path('pos'), (snap) => {
      const all = (snap.val() ?? {}) as Record<string, PosSample>;
      const now = serverNow();
      for (const [uid, sample] of Object.entries(all)) {
        if (uid === this.uid) continue;
        const buf = this.positions.get(uid) ?? [];
        if (!buf.length || sample.t > buf[buf.length - 1].t) buf.push(sample);
        while (buf.length > 2 && buf[0].t < now - POS_BUFFER_MS) buf.shift();
        this.positions.set(uid, buf);
      }
    }));

    this.unsubs.push(onChildAdded(this.path('shots'), (snap) => {
      const id = snap.key!;
      if (this.seenShots.has(id)) return;
      this.seenShots.add(id);
      const shot = snap.val() as Shot;
      if (serverNow() - shot.t > TUNING.echoDelayMs + 3000) return;
      this.onShot?.(id, shot);
    }));

    this.unsubs.push(onChildAdded(this.path('hits'), (snap) => {
      const hit = snap.val() as Hit;
      if (serverNow() - hit.t > 5000) return;
      if (this.isHost) this.pendingHits.push([snap.key!, hit]);
      this.onHit?.(snap.key!, hit);
    }));

    // Presence: mark ourselves connected, and let the server flip it when the socket drops.
    this.unsubs.push(onValue(ref(this.db, '.info/connected'), (snap) => {
      if (snap.val() !== true) return;
      const connected = this.path(`players/${this.uid}/connected`);
      onDisconnect(connected).set(false).then(() => set(connected, true)).catch(console.error);
    }));
    return this;
  }

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private bump() { this.version++; this.listeners.forEach((fn) => fn()); }

  get isHost() { return this.meta?.hostUid === this.uid; }
  get status(): RoomStatus | undefined { return this.meta?.status; }
  get match(): Match | undefined { return this.meta?.match; }
  slotOf(uid: string) { return this.meta?.players[uid]?.slot ?? 0; }
  seatOf(uid: string) { return this.meta?.match?.seats?.[uid] ?? this.slotOf(uid); }
  figureOf(uid: string) { return this.meta?.players[uid]?.figure ?? 0; }

  /** Lobby only. A colour someone else wears is refused. */
  async setLook(look: Look) {
    const players = this.meta?.players ?? {};
    if (Object.values(players).some((p) => p.id !== this.uid && p.slot === look.slot)) return;
    await update(this.path(`players/${this.uid}`), { slot: look.slot, figure: look.figure });
  }

  async setSettings(settings: RoomSettings) {
    if (this.isHost) await update(this.path(), { settings });
  }

  /** Publishes our position at ~20 Hz, or immediately when stunned state changes. */
  publishPos(sample: PosSample, force = false) {
    const now = sample.t;
    const last = this.lastPos;
    const moved = !last || Math.abs(last.x - sample.x) > 0.5 || Math.abs(last.y - sample.y) > 0.5 || Math.abs(last.a - sample.a) > 0.05 || last.s !== sample.s;
    if (!force && (now - this.lastPosWrite < 50 || (!moved && now - this.lastPosWrite < 400))) return;
    this.lastPosWrite = now;
    this.lastPos = sample;
    set(this.path(`pos/${this.uid}`), sample).catch(console.error);
  }

  /** Returns the shot id immediately so the local bolt and the remote one share a key. */
  fire(shot: Omit<Shot, 'o'>) {
    const r = push(this.path('shots'));
    this.seenShots.add(r.key!);
    set(r, { ...shot, o: this.uid }).catch(console.error);
    return r.key!;
  }

  reportHit(hit: Omit<Hit, 'v'>) {
    push(this.path('hits'), { ...hit, v: this.uid }).catch(console.error);
  }

  async start() {
    if (!this.meta) return;
    const players = Object.values(this.meta.players).filter((p) => p.connected);
    if (players.length < 2) throw new Error('Refraction needs at least two connected players.');
    const now = serverNow();
    const roundMs = this.meta.settings?.roundMs ?? TUNING.roundMs;
    const winScore = this.meta.settings?.winScore ?? TUNING.winScore;
    const seats = Object.fromEntries([...players].sort((a, b) => a.slot - b.slot).map((p, i) => [p.id, i]));
    const match: Match = { round: (this.meta.match?.round ?? 0) + 1, startsAt: now + TUNING.countdownMs, endsAt: now + TUNING.countdownMs + roundMs, seats, winScore };
    const state = createArenaState(players.map((p) => p.id), now);
    this.processedHits.clear();
    this.pendingHits.length = 0;
    await update(this.path(), { status: 'playing', match, state, shots: null, hits: null, pos: null });
  }

  async backToLobby() {
    await update(this.path(), { status: 'lobby', shots: null, hits: null, pos: null });
  }

  async leave() {
    await set(this.path(`players/${this.uid}/connected`), false).catch(() => {});
    this.dispose();
  }

  dispose() {
    this.unsubs.forEach((u) => u());
    this.unsubs.length = 0;
    this.listeners.clear();
    window.clearInterval(this.hostTimer);
    this.hostTimer = 0;
  }

  /** Latest known position of any player (remote from buffer; local supplied by the scene). */
  localPos?: PosSample;
  latest(uid: string): PosSample | undefined {
    if (uid === this.uid) return this.localPos;
    const buf = this.positions.get(uid);
    return buf?.[buf.length - 1];
  }

  private syncHostLoop() {
    const shouldRun = this.isHost && this.status === 'playing';
    if (shouldRun && !this.hostTimer) this.hostTimer = window.setInterval(() => this.hostTick(), 50);
    if (!shouldRun && this.hostTimer) { window.clearInterval(this.hostTimer); this.hostTimer = 0; }
  }

  private lastStateWrite = 0;
  private dirty = false;
  private ending = false;

  private hostTick() {
    const match = this.match;
    if (!match || !this.meta) return;
    const now = serverNow();
    const state = this.state;
    const events: HostEvent[] = [];

    while (this.pendingHits.length) {
      const [id, hit] = this.pendingHits.shift()!;
      if (this.processedHits.has(id) || hit.t < match.startsAt) continue;
      this.processedHits.add(id);
      applyHit(state, hit.v, hit.by, hit, now);
      this.dirty = true;
    }

    if (now >= match.startsAt) {
      const players: Record<string, HostPlayer> = {};
      for (const p of Object.values(this.meta.players)) {
        if (!(p.id in state.score)) continue;
        const pos = this.latest(p.id);
        if (pos) players[p.id] = { x: pos.x, y: pos.y, stunnedUntil: pos.s, slot: this.seatOf(p.id) };
      }
      const step = hostStep(state, players, now, Math.random, match.winScore ?? TUNING.winScore);
      if (step.changed) this.dirty = true;
      events.push(...step.events);
    }

    if ((now >= match.endsAt || state.winner) && !this.ending) {
      this.ending = true;
      update(this.path(), { status: 'results', state }).catch(console.error).finally(() => { this.ending = false; });
      this.dirty = false;
      return;
    }

    if (this.dirty && now - this.lastStateWrite >= 60) {
      this.dirty = false;
      this.lastStateWrite = now;
      set(this.path('state'), JSON.parse(JSON.stringify(state))).catch(console.error);
    }
    if (events.length) this.onHostEvents?.(events);
  }
}
