import Phaser from 'phaser';
import { panFor, sfx } from '../audio/sfx';
import { AH, ART, AW, paintArena } from '../art/floor';
import { KEEPERS, P, hexNum, keeperOf } from '../art/palette';
import { SHARD, beaconSprite, ghostSprite, keeperSprite, paintCanvas, type SpriteDef } from '../art/sprites';
import { serverNow } from '../firebase';
import type { GameSession } from '../net/types';
import type { Hit, PosSample, Shot } from '../types';
import { H, OBSTACLES, SHRINES, SPAWNS, TUNING, W } from './constants';
import { dist, pointAt, resolveCircle, sweepHits, traceBolt, type BoltPath, type Vec } from './geometry';
import { CENTER, type ArenaState } from './host';

const FONT = '"Pixelify Sans", monospace';
const INK = hexNum(P.ink);
const LAMP_L = hexNum(P.lampL);

interface Bolt {
  id: string; owner: string; echo: boolean; t0: number; path: BoltPath; slot: number;
  stopD: number | null; checkedD: number; nextBounce: number; started: boolean; ended: boolean;
}

interface Avatar { body: Phaser.GameObjects.Image; ghost: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; slot: number; lastX: number; lastY: number; facing: 1 | -1 }
interface Stick { id: number; bx: number; by: number; x: number; y: number }

const snap = (v: number) => Math.floor(v / ART) * ART;
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

function sampleAt(buf: PosSample[], t: number): PosSample | undefined {
  if (!buf.length) return undefined;
  if (t <= buf[0].t) return buf[0];
  for (let i = buf.length - 1; i > 0; i--) {
    const a = buf[i - 1];
    const b = buf[i];
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: lerpAngle(a.a, b.a, k), t, s: b.s };
    }
  }
  return buf[buf.length - 1];
}

export class ArenaScene extends Phaser.Scene {
  private session!: GameSession;
  private uid = '';
  private quiet = false;
  private touch = false;

  private round = -1;
  private me = { x: 0, y: 0, aim: 0, vx: 0, vy: 0, stunnedUntil: 0, immuneUntil: 0, lastFire: 0, walked: 0, firstShot: 0 };
  private history: PosSample[] = [];
  private bolts = new Map<string, Bolt>();
  private avatars = new Map<string, Avatar>();
  private shardSprites = new Map<string, Phaser.GameObjects.Image>();
  private predicted = new Map<string, number>();
  private beacons: Array<{ uid: string; img: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text }> = [];
  private beaconKey = '';
  private prevState?: ArenaState;
  private lastCount = -1;
  private lastPickupSound = 0;
  private hints: Phaser.GameObjects.Text[] = [];

  private light!: Phaser.GameObjects.RenderTexture;
  private beams!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private ui!: Phaser.GameObjects.Graphics;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;

  private keys?: Record<string, Phaser.Input.Keyboard.Key>;
  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  private mouse = { x: W / 2, y: H / 2, down: false, active: false };
  private fireQueued = false;
  private sfx: typeof sfx = sfx;

  constructor() { super('arena'); }

  init(data: { session: GameSession }) {
    this.session = data.session;
    this.uid = data.session.uid;
    this.quiet = data.session.kind === 'demo';
    if (this.quiet) this.sfx = new Proxy(sfx, { get: () => () => {} });
  }

  create() {
    this.touch = this.sys.game.device.input.touch && window.matchMedia('(pointer: coarse)').matches;
    this.makeTextures();
    this.add.image(0, 0, 'arena').setOrigin(0).setScale(ART).setDepth(0);

    this.light = this.add.renderTexture(0, 0, AW, AH).setOrigin(0).setScale(ART).setDepth(7);
    this.beams = this.add.graphics().setDepth(8);
    this.overlay = this.add.graphics().setDepth(10);
    this.ui = this.add.graphics().setDepth(20);
    this.burst = this.add.particles(0, 0, 'px', {
      lifespan: { min: 180, max: 520 }, speed: { min: 50, max: 260 }, gravityY: 180, emitting: false,
    }).setDepth(9);

    if (!this.quiet) this.setupInput();
    this.session.onShot = (id, shot) => this.addShot(id, shot);
    this.session.onHit = (id, hit) => this.handleHit(id, hit);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.session.onShot = undefined; this.session.onHit = undefined; });
  }

  // ---------- art ----------

  private addSprite(key: string, def: SpriteDef) {
    if (!this.textures.exists(key)) this.textures.addCanvas(key, paintCanvas(def));
  }

  private makeTextures() {
    if (!this.textures.exists('arena')) this.textures.addCanvas('arena', paintArena());
    KEEPERS.forEach((_, slot) => {
      this.addSprite(`keeper-${slot}-0`, keeperSprite(slot, 0));
      this.addSprite(`keeper-${slot}-1`, keeperSprite(slot, 1));
      this.addSprite(`ghost-${slot}`, ghostSprite(slot));
      this.addSprite(`beacon-${slot}`, beaconSprite(slot, true));
    });
    this.addSprite('shard', SHARD);
    this.addSprite('px', { grid: ['xxxx', 'xxxx', 'xxxx', 'xxxx'], colors: { x: '#ffffff' } });

    // Lantern light: stepped, dithered discs, erased out of the darkness layer.
    const light = (key: string, r: number) => {
      if (this.textures.exists(key)) return;
      const size = r * 2 + 1;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d')!;
      const bayer = [[0, 2], [3, 1]];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const d = Math.hypot(x - r, y - r) / r;
          if (d > 1) continue;
          const level = d < 0.45 ? 1 : d < 0.72 ? 0.62 : 0.3;
          if (d > 0.9 && bayer[y % 2][x % 2] < 2) continue;
          ctx.fillStyle = `rgba(255,255,255,${level})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
      this.textures.addCanvas(key, c);
    };
    light('light-keeper', 26);
    light('light-beacon', 18);
    light('light-small', 7);
    light('light-tiny', 4);
  }

  // ---------- input ----------

  private setupInput() {
    this.input.addPointer(2);
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE') as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.on('keydown-SPACE', () => { this.fireQueued = true; });
    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) {
        const stick = { id: p.id, bx: p.x, by: p.y, x: p.x, y: p.y };
        if (p.x < W / 2 && !this.moveStick) this.moveStick = stick;
        else if (!this.aimStick) this.aimStick = stick;
      } else {
        this.mouse = { x: p.x, y: p.y, down: true, active: true };
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.wasTouch) {
        for (const s of [this.moveStick, this.aimStick]) if (s && s.id === p.id) { s.x = p.x; s.y = p.y; }
      } else {
        this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.active = true;
      }
    });
    const release = (p: Phaser.Input.Pointer) => {
      if (this.moveStick?.id === p.id) this.moveStick = null;
      if (this.aimStick?.id === p.id) {
        const s = this.aimStick;
        if (Math.hypot(s.x - s.bx, s.y - s.by) > 14) this.me.aim = Math.atan2(s.y - s.by, s.x - s.bx);
        else this.me.aim = this.autoAim() ?? this.me.aim;
        this.fireQueued = true;
        this.aimStick = null;
      }
      if (!p.wasTouch) this.mouse.down = false;
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
  }

  private autoAim(): number | null {
    let best: Vec | null = null;
    let bestD = Infinity;
    for (const uid of Object.keys(this.session.state.score)) {
      if (uid === this.uid) continue;
      const p = this.remotePos(uid);
      if (!p) continue;
      const d = dist(p, this.me);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? Math.atan2(best.y - this.me.y, best.x - this.me.x) : null;
  }

  private moveVector(): Vec {
    if (this.moveStick) {
      const dx = this.moveStick.x - this.moveStick.bx;
      const dy = this.moveStick.y - this.moveStick.by;
      const len = Math.hypot(dx, dy);
      if (len < 6) return { x: 0, y: 0 };
      const k = Math.min(1, len / 60) / len;
      return { x: dx * k, y: dy * k };
    }
    const k = this.keys;
    if (!k) return { x: 0, y: 0 };
    const x = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const y = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  // ---------- bolts & hits ----------

  private nameOf(uid: string) { return this.session.meta?.players[uid]?.name ?? 'Someone'; }

  private addShot(id: string, shot: Shot) {
    const slot = this.session.slotOf(shot.o);
    const path = traceBolt(shot.x, shot.y, shot.a);
    const base = { owner: shot.o, path, slot, stopD: null, checkedD: 0, nextBounce: 1, started: false, ended: false };
    this.bolts.set(id, { ...base, id, echo: false, t0: shot.t });
    this.bolts.set(`${id}~e`, { ...base, id: `${id}~e`, echo: true, t0: shot.t + TUNING.echoDelayMs });
  }

  private boltD(b: Bolt, now: number) {
    return Math.min(((now - b.t0) * TUNING.boltSpeed) / 1000, b.stopD ?? b.path.length);
  }

  private pop(x: number, y: number, colors: string[], count: number) {
    const per = Math.ceil(count / colors.length);
    for (const c of colors) { this.burst.setParticleTint(hexNum(c)); this.burst.explode(per, x, y); }
  }

  private handleHit(_id: string, hit: Hit) {
    const b = this.bolts.get(hit.echo ? `${hit.sid}~e` : hit.sid);
    if (b && b.stopD === null) b.stopD = this.boltD(b, serverNow());
    const how = hit.echo ? "'s echo caught" : ' caught';
    const victim = hit.v === this.uid && !this.quiet ? 'you' : this.nameOf(hit.v);
    this.session.pushFeed(`${this.nameOf(hit.by)}${how} ${victim}`, this.session.slotOf(hit.by));
    if (hit.v === this.uid && !this.quiet) return;
    const k = keeperOf(this.session.slotOf(hit.v));
    this.pop(hit.x, hit.y, [k.cloak, P.lampL, P.parchment], 30);
    this.sfx.hit(panFor(hit.x));
    if (hit.by === this.uid && !this.quiet) { this.floater(hit.x, hit.y - 44, 'CAUGHT', P.lampL); this.cameras.main.shake(80, 0.003); }
  }

  private gotHit(b: Bolt, d: number, now: number) {
    const a = pointAt(b.path, Math.max(0, d - 12));
    const c = pointAt(b.path, d);
    const len = Math.hypot(c.x - a.x, c.y - a.y) || 1;
    b.stopD = d;
    this.me.stunnedUntil = now + TUNING.stunMs;
    this.me.immuneUntil = now + TUNING.immuneMs;
    this.me.vx = ((c.x - a.x) / len) * TUNING.knockback;
    this.me.vy = ((c.y - a.y) / len) * TUNING.knockback;
    this.session.reportHit({ by: b.owner, sid: b.echo ? b.id.slice(0, -2) : b.id, echo: b.echo, x: Math.round(this.me.x), y: Math.round(this.me.y), t: now });
    this.session.publishPos({ x: this.me.x, y: this.me.y, a: this.me.aim, t: now, s: this.me.stunnedUntil }, true);
    if (this.session.kind !== 'online') this.session.pushFeed(`${this.nameOf(b.owner)}${b.echo ? "'s echo caught" : ' caught'} you`, this.session.slotOf(b.owner));
    this.cameras.main.shake(200, 0.01);
    this.cameras.main.flash(120, 176, 74, 51);
    const k = keeperOf(this.session.slotOf(this.uid));
    this.pop(this.me.x, this.me.y, [k.cloak, P.lampL, P.rust], 34);
    this.sfx.hit(0);
    this.sfx.stunned();
    const carrying = (this.session.state.carry[this.uid] ?? 0) + this.predicted.size;
    if (carrying > 0) { this.sfx.drop(); this.floater(this.me.x, this.me.y - 50, `DROPPED ${carrying}`, P.rust); }
    this.predicted.clear();
  }

  private fire(now: number) {
    this.me.lastFire = now;
    if (!this.me.firstShot) this.me.firstShot = now;
    const shot = { x: Math.round(this.me.x), y: Math.round(this.me.y), a: Math.round(this.me.aim * 1000) / 1000, t: now };
    const id = this.session.fire(shot);
    this.addShot(id, { ...shot, o: this.uid });
    const k = keeperOf(this.session.slotOf(this.uid));
    this.pop(this.me.x + Math.cos(this.me.aim) * 24, this.me.y + Math.sin(this.me.aim) * 24, [k.cloak, P.lampL], 8);
    this.sfx.fire(panFor(this.me.x), true);
    this.session.flag('fired');
  }

  // ---------- helpers ----------

  private floater(x: number, y: number, text: string, color: string) {
    const t = this.add.text(snap(x), snap(y), text, { fontFamily: FONT, fontSize: '16px', color, backgroundColor: P.ink, padding: { x: 4, y: 1 } }).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: t, y: y - 36, duration: 900, ease: 'Stepped', easeParams: [6], onComplete: () => t.destroy() });
  }

  private hint(x: number, y: number, text: string, ms: number) {
    const cx = Math.max(90, Math.min(W - 90, x));
    const cy = Math.max(20, Math.min(H - 20, y));
    const t = this.add.text(snap(cx), snap(cy), text, { fontFamily: FONT, fontSize: '14px', color: P.ink, backgroundColor: P.lamp, padding: { x: 5, y: 2 } }).setOrigin(0.5).setDepth(12);
    this.hints.push(t);
    this.time.delayedCall(ms, () => t.destroy());
    return t;
  }

  private remotePos(uid: string, delay = TUNING.interpDelayMs): PosSample | undefined {
    const buf = this.session.positions.get(uid);
    return buf ? sampleAt(buf, serverNow() - delay) : undefined;
  }

  private avatar(uid: string, slot: number, name: string): Avatar {
    let a = this.avatars.get(uid);
    if (a) return a;
    const mine = uid === this.uid && !this.quiet;
    a = {
      ghost: this.add.image(0, 0, `ghost-${slot}`).setScale(ART).setOrigin(0.44, 0.6).setDepth(4).setAlpha(0.85),
      body: this.add.image(0, 0, `keeper-${slot}-0`).setScale(ART).setOrigin(0.44, 0.6).setDepth(5),
      label: this.add.text(0, 0, mine ? 'YOU' : name, { fontFamily: FONT, fontSize: '14px', color: mine ? P.ink : P.parchment, backgroundColor: mine ? P.lamp : P.ink, padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(11),
      slot, lastX: 0, lastY: 0, facing: 1,
    };
    this.avatars.set(uid, a);
    return a;
  }

  private resetRound(round: number) {
    this.round = round;
    const slot = this.session.slotOf(this.uid);
    const [x, y] = SPAWNS[slot % SPAWNS.length];
    this.me = { x, y, aim: Math.atan2(360 - y, 640 - x), vx: 0, vy: 0, stunnedUntil: 0, immuneUntil: 0, lastFire: 0, walked: 0, firstShot: 0 };
    this.history = [];
    this.bolts.clear();
    this.predicted.clear();
    this.prevState = undefined;
    this.beaconKey = '';
    this.hints.forEach((h) => h.destroy());
    this.hints = [];
    this.shardSprites.forEach((sp) => sp.destroy());
    this.shardSprites.clear();
    if (!this.quiet && this.uid in this.session.state.score) {
      const [sx, sy] = SHRINES[slot % SHRINES.length];
      const inward = x < W / 2 ? 1 : -1;
      this.hint(x + inward * 120, y + 8, 'THIS IS YOU', 5200);
      this.hint(sx, sy + (sy < H / 2 ? 104 : -110), 'BANK LENSES HERE', 7000);
    }
  }

  private buildBeacons() {
    const uids = Object.keys(this.session.state.score).sort();
    const key = uids.map((u) => `${u}:${this.session.slotOf(u)}`).join('|');
    if (key === this.beaconKey) return;
    this.beaconKey = key;
    this.beacons.forEach((b) => { b.img.destroy(); b.label.destroy(); });
    this.beacons = uids.map((uid) => {
      const slot = this.session.slotOf(uid);
      const [x, y] = SHRINES[slot % SHRINES.length];
      return {
        uid,
        img: this.add.image(x, y + 8, `beacon-${slot}`).setScale(ART).setOrigin(0.5, 0.86).setDepth(3),
        label: this.add.text(x, y + 26, '', { fontFamily: FONT, fontSize: '14px', color: P.parchment, backgroundColor: P.ink, padding: { x: 4, y: 1 } }).setOrigin(0.5, 0).setDepth(11),
      };
    });
  }

  // ---------- frame ----------

  update(_time: number, delta: number) {
    const s = this.session;
    const match = s.match;
    if (!match || !s.meta) return;
    const now = serverNow();
    const dt = Math.min(delta, 50) / 1000;
    if (match.round !== this.round) this.resetRound(match.round);
    this.buildBeacons();

    const playing = !this.quiet && this.uid in s.state.score;
    const live = now >= match.startsAt && now < match.endsAt;
    const stunned = now < this.me.stunnedUntil;

    const count = Math.ceil((match.startsAt - now) / 1000);
    if (count !== this.lastCount && count >= 0 && count <= 3) { this.sfx.countdown(count === 0); this.lastCount = count; }

    if (playing) {
      const carry = (s.state.carry[this.uid] ?? 0) + this.predicted.size;
      const before = { x: this.me.x, y: this.me.y };
      if (live && !stunned) {
        const mv = this.moveVector();
        const speed = TUNING.speed * (1 - carry * TUNING.carrySlowdown);
        this.me.x += mv.x * speed * dt;
        this.me.y += mv.y * speed * dt;
      }
      this.me.x += this.me.vx * dt;
      this.me.y += this.me.vy * dt;
      const decay = Math.exp(-7 * dt);
      this.me.vx *= decay;
      this.me.vy *= decay;
      const p = resolveCircle(this.me, TUNING.runnerRadius);
      this.me.x = p.x;
      this.me.y = p.y;
      this.me.walked += dist(before, this.me);
      if (this.me.walked > 160) s.flag('moved');

      if (this.aimStick) {
        const dx = this.aimStick.x - this.aimStick.bx;
        const dy = this.aimStick.y - this.aimStick.by;
        if (Math.hypot(dx, dy) > 14) this.me.aim = Math.atan2(dy, dx);
      } else if (!this.touch && this.mouse.active) {
        this.me.aim = Math.atan2(this.mouse.y - this.me.y, this.mouse.x - this.me.x);
      }

      const wantsFire = this.fireQueued || this.mouse.down || Boolean(this.keys?.SPACE.isDown);
      this.fireQueued = false;
      if (wantsFire && live && !stunned && now - this.me.lastFire >= TUNING.fireCooldownMs) this.fire(now);

      const sample: PosSample = { x: Math.round(this.me.x * 10) / 10, y: Math.round(this.me.y * 10) / 10, a: Math.round(this.me.aim * 100) / 100, t: now, s: this.me.stunnedUntil };
      this.history.push(sample);
      while (this.history.length > 2 && this.history[0].t < now - TUNING.echoDelayMs - 500) this.history.shift();
      s.localPos = sample;
      s.publishPos(sample);
    }

    this.light.clear();
    this.light.fill(INK, 0.5);
    this.updateBolts(now, live && playing);
    this.syncShards(now, live && playing);
    this.diffState(now);
    this.drawKeepers(now);
    this.drawBeacons(now);
    this.drawUi(now);
  }

  private lightAt(key: string, x: number, y: number, r: number) {
    this.light.erase(key, Math.floor(x / ART) - r, Math.floor(y / ART) - r);
  }

  private updateBolts(now: number, canBeHit: boolean) {
    const g = this.beams;
    g.clear();
    const immune = now < this.me.immuneUntil;
    for (const [id, b] of this.bolts) {
      const k = keeperOf(b.slot);

      // Echo warning: the path the echo is about to take, blinking, for the last 700 ms.
      if (now < b.t0) {
        if (b.echo && b.t0 - now < 700 && Math.floor(now / 90) % 2 === 0) {
          const reach = Math.min(b.path.length, 260);
          g.fillStyle(hexNum(k.ghost), 0.9);
          for (let d = 20; d < reach; d += 16) { const p = pointAt(b.path, d); g.fillRect(snap(p.x), snap(p.y), ART, ART); }
        }
        continue;
      }

      const d = this.boltD(b, now);
      const end = b.stopD ?? b.path.length;
      if (((now - b.t0) * TUNING.boltSpeed) / 1000 > end + 60) { this.bolts.delete(id); continue; }

      if (!b.started) {
        b.started = true;
        const o = b.path.points[0];
        if (b.echo) {
          this.pop(o.x, o.y, [k.ghost, P.lampL], 10);
          this.sfx.echoFire(panFor(o.x));
          if (b.owner === this.uid && !this.quiet) {
            this.session.flag('echo');
            if (now - this.me.firstShot < 3500) this.hint(o.x, o.y - 56, 'YOUR ECHO FIRED', 1600);
          }
        } else if (b.owner !== this.uid) this.sfx.fire(panFor(o.x), false);
      }

      if (canBeHit && !immune && b.owner !== this.uid && b.stopD === null && d > b.checkedD) {
        if (sweepHits(b.path, b.checkedD, d, this.me, TUNING.runnerRadius + TUNING.boltRadius)) this.gotHit(b, d, now);
      }
      b.checkedD = d;

      while (b.nextBounce < b.path.points.length - 1 && b.path.cum[b.nextBounce] <= d) {
        const p = b.path.points[b.nextBounce];
        this.pop(p.x, p.y, [P.lampL, P.glassL], b.echo ? 4 : 8);
        if (!b.echo) { this.sfx.bounce(panFor(p.x)); if (b.owner === this.uid) this.session.flag('bounced'); }
        b.nextBounce++;
      }
      if (!b.ended && d >= b.path.length && b.stopD === null) {
        b.ended = true;
        const p = b.path.points[b.path.points.length - 1];
        this.pop(p.x, p.y, b.path.end === 'stone' ? [P.stoneL, P.brass] : [P.lampL], 8);
        if (b.path.end === 'stone') this.sfx.absorb(panFor(p.x));
      }

      // The beam: snapped to the art grid, a bright core inside the keeper's colour, with a dithered tail.
      if (d >= end && b.stopD !== null) continue;
      const len = b.echo ? 110 : 170;
      const tail = Math.max(0, d - len);
      const outer = hexNum(b.echo ? k.ghost : k.cloak);
      const seen = new Set<number>();
      for (let t = d; t >= tail; t -= ART) {
        const p = pointAt(b.path, t);
        const cx = snap(p.x);
        const cy = snap(p.y);
        const key = cx * 4096 + cy;
        if (seen.has(key)) continue;
        seen.add(key);
        const age = (d - t) / len;
        const dither = ((cx + cy) / ART) % 2 === 0;
        if (age > 0.55 && !dither) continue;
        if (b.echo && !dither) continue;
        if (age < 0.55 && !b.echo) { g.fillStyle(outer, 1); g.fillRect(cx - ART, cy - ART, ART * 3, ART * 3); }
        g.fillStyle(age < 0.3 ? LAMP_L : outer, 1);
        g.fillRect(cx, cy, ART, ART);
      }
      if (d < end) {
        const h = pointAt(b.path, d);
        g.fillStyle(LAMP_L, 1).fillRect(snap(h.x) - ART, snap(h.y) - ART, ART * 3, ART * 3);
        this.lightAt('light-small', h.x, h.y, 7);
      }
    }
  }

  private syncShards(now: number, canPick: boolean) {
    const shards = this.session.state.shards;
    for (const [id, sprite] of this.shardSprites) {
      if (!(id in shards)) {
        if (!this.predicted.has(id)) this.pop(sprite.x, sprite.y, [P.lamp, P.lampL], 8);
        sprite.destroy();
        this.shardSprites.delete(id);
        this.predicted.delete(id);
      }
    }
    const carry = this.session.state.carry[this.uid] ?? 0;
    for (const [id, shard] of Object.entries(shards)) {
      let sprite = this.shardSprites.get(id);
      const flying = shard.born !== undefined && now - shard.born < TUNING.castFlightMs;
      if (!sprite) {
        sprite = this.add.image(snap(shard.x), snap(shard.y), 'shard').setScale(ART).setDepth(flying ? 12 : 3);
        this.shardSprites.set(id, sprite);
        if (flying) { this.pop(CENTER.x, CENTER.y, [P.lamp, P.lampL, P.brass], 14); this.sfx.cast(panFor(shard.x)); }
        else this.pop(shard.x, shard.y, [P.lampL], 5);
        sprite.setData('landed', !flying);
      }
      if (flying) {
        const t = (now - shard.born!) / TUNING.castFlightMs;
        const fx = CENTER.x + (shard.x - CENTER.x) * t;
        const fy = CENTER.y + (shard.y - CENTER.y) * t - Math.sin(t * Math.PI) * 150;
        sprite.setPosition(snap(fx), snap(fy)).setVisible(true).setAlpha(1);
        if (Math.floor(now / 50) % 2) this.pop(fx, fy, [P.lamp], 1);
        this.lightAt('light-small', fx, fy, 7);
        continue;
      }
      if (!sprite.getData('landed')) {
        sprite.setData('landed', true).setDepth(3);
        this.pop(shard.x, shard.y, [P.lamp, P.stoneL], 10);
      }
      const locked = shard.lockUid === this.uid && now < (shard.lockUntil ?? 0);
      const bob = Math.floor(now / 420 + shard.x) % 2 ? ART : 0;
      sprite.setPosition(snap(shard.x), snap(shard.y) - bob);

      const predictedAt = this.predicted.get(id);
      if (predictedAt !== undefined) {
        sprite.setVisible(false);
        if (now - predictedAt > 900) { this.predicted.delete(id); sprite.setVisible(true); }
        continue;
      }
      sprite.setVisible(true).setAlpha(locked && Math.floor(now / 120) % 2 ? 0.35 : 1);
      this.lightAt('light-tiny', shard.x, shard.y, 4);
      const held = carry + this.predicted.size;
      if (canPick && !locked && now >= this.me.stunnedUntil && held < TUNING.carryMax && dist(this.me, shard) < TUNING.pickupRadius) {
        this.predicted.set(id, now);
        sprite.setVisible(false);
        this.pop(shard.x, shard.y, [P.lamp, P.lampL], 10);
        this.sfx.pickup(held + 1, panFor(shard.x));
        this.lastPickupSound = now;
        if (held === 0 && !this.session.flags.has('banked')) this.hint(this.me.x, this.me.y - 70, 'TAKE IT TO YOUR BEACON', 2200);
      }
    }
  }

  private diffState(now: number) {
    const state = this.session.state;
    const prev = this.prevState;
    if (prev === state) return;
    this.prevState = state;
    if (!prev) return;
    for (const [uid, score] of Object.entries(state.score)) {
      const gained = score - (prev.score[uid] ?? 0);
      if (gained <= 0) continue;
      const slot = this.session.slotOf(uid);
      const [x, y] = SHRINES[slot % SHRINES.length];
      const k = keeperOf(slot);
      const mine = uid === this.uid && !this.quiet;
      this.pop(x, y - 40, [k.cloak, P.lamp, P.lampL], 24 + gained * 8);
      this.floater(x, y - 80, `+${gained}`, mine ? P.lamp : k.ghost);
      this.sfx.bank(gained, mine, panFor(x));
      this.session.pushFeed(`${mine ? 'You' : this.nameOf(uid)} banked ${gained}`, slot);
      if (mine) this.cameras.main.flash(90, 243, 207, 107);
    }
    for (const [uid, score] of Object.entries(state.score)) {
      if (score >= (prev.score[uid] ?? 0)) continue;
      const slot = this.session.slotOf(uid);
      const [x, y] = SHRINES[slot % SHRINES.length];
      this.pop(x, y - 40, [P.rust, P.lamp], 18);
      this.floater(x, y - 80, 'STOLEN', P.rust);
      const thief = Object.keys(state.carry).find((u) => u !== uid && (state.carry[u] ?? 0) > (prev.carry[u] ?? 0));
      if (thief) {
        const mine = thief === this.uid && !this.quiet;
        this.session.pushFeed(`${mine ? 'You' : this.nameOf(thief)} stole a lens from ${uid === this.uid && !this.quiet ? 'you' : this.nameOf(uid)}`, this.session.slotOf(thief));
        if (mine) { this.floater(this.me.x, this.me.y - 80, 'STOLE 1', P.lamp); this.sfx.pickup(3, 0); this.lastPickupSound = now; }
      }
    }
    if (state.winner && !prev.winner) {
      const slot = this.session.slotOf(state.winner);
      const [x, y] = SHRINES[slot % SHRINES.length];
      const k = keeperOf(slot);
      this.pop(x, y - 40, [k.cloak, P.lamp, P.lampL, P.parchment], 90);
      this.floater(x, y - 110, 'LIGHTHOUSE LIT', P.lamp);
      if (!this.quiet) this.cameras.main.flash(260, 251, 236, 192);
    }
    const mineCarry = state.carry[this.uid] ?? 0;
    if (mineCarry > (prev.carry[this.uid] ?? 0) && now - this.lastPickupSound > 600) this.sfx.pickup(mineCarry, 0);
  }

  private drawKeepers(now: number) {
    const s = this.session;
    const o = this.overlay;
    o.clear();
    for (const uid of Object.keys(s.state.score)) {
      const player = s.meta!.players[uid];
      if (!player) continue;
      const a = this.avatar(uid, player.slot, player.name);
      const mine = uid === this.uid && !this.quiet;
      const pos = mine ? s.localPos : this.remotePos(uid);
      const echoPos = mine ? sampleAt(this.history, now - TUNING.echoDelayMs) : this.remotePos(uid, TUNING.echoDelayMs);
      a.body.setVisible(Boolean(pos));
      a.label.setVisible(Boolean(pos));
      const echoVisible = Boolean(echoPos) && now > (s.match?.startsAt ?? 0) + TUNING.echoDelayMs;
      a.ghost.setVisible(echoVisible);
      if (echoPos && echoVisible) a.ghost.setPosition(snap(echoPos.x), snap(echoPos.y)).setFlipX(Math.cos(echoPos.a) < 0);
      if (!pos) continue;

      const moving = Math.hypot(pos.x - a.lastX, pos.y - a.lastY) > 0.4;
      a.lastX = pos.x;
      a.lastY = pos.y;
      const facing = Math.cos(pos.a) < -0.2 ? -1 : Math.cos(pos.a) > 0.2 ? 1 : a.facing;
      a.facing = facing;
      const stunned = now < pos.s;
      const frame = moving && !stunned && Math.floor(now / 140) % 2 ? 1 : 0;
      a.body.setTexture(`keeper-${a.slot}-${frame}`).setFlipX(facing < 0).setPosition(snap(pos.x), snap(pos.y) - (frame ? ART : 0)).setAngle(stunned ? -facing * 90 : 0);
      const blink = stunned ? Math.floor(now / 80) % 2 === 0 : mine && now < this.me.immuneUntil && Math.floor(now / 120) % 2 === 0;
      if (blink) a.body.setTintFill(hexNum(P.parchment)); else a.body.clearTint();
      a.body.setAlpha(player.connected ? 1 : 0.4);
      a.label.setPosition(snap(pos.x), snap(pos.y) - 40);
      this.lightAt('light-keeper', pos.x, pos.y, 26);

      const k = keeperOf(a.slot);
      if (stunned) {
        for (let i = 0; i < 3; i++) {
          const ang = now / 160 + (i * Math.PI * 2) / 3;
          o.fillStyle(LAMP_L, 1).fillRect(snap(pos.x + Math.cos(ang) * 20), snap(pos.y - 52 + Math.sin(ang) * 5), ART, ART);
        }
      }

      const carry = (s.state.carry[uid] ?? 0) + (mine ? this.predicted.size : 0);
      for (let i = 0; i < carry; i++) {
        const cx = snap(pos.x) - (carry * 3 * ART) / 2 + i * 3 * ART + ART;
        const cy = snap(pos.y) - 64;
        o.fillStyle(INK, 1).fillRect(cx - ART, cy - ART, ART * 3, ART * 4);
        o.fillStyle(hexNum(P.lamp), 1).fillRect(cx, cy, ART, ART * 2);
      }

      if (mine) {
        // Aim preview: dotted, snapped, following bounces.
        if (!stunned && (!this.touch || this.aimStick)) {
          const path = traceBolt(pos.x, pos.y, pos.a);
          const reach = Math.min(path.length, this.touch ? 520 : 320);
          o.fillStyle(hexNum(P.parchment), 0.7);
          for (let d = 28; d < reach; d += 14) { const p = pointAt(path, d); o.fillRect(snap(p.x), snap(p.y), ART, ART); }
        }
        const ready = Math.min(1, (now - this.me.lastFire) / TUNING.fireCooldownMs);
        const bx = snap(pos.x) - 4 * ART;
        const by = snap(pos.y) + 8 * ART;
        o.fillStyle(INK, 1).fillRect(bx - ART, by - ART, 10 * ART, 3 * ART);
        o.fillStyle(ready >= 1 ? hexNum(P.lamp) : hexNum(P.brassD), 1).fillRect(bx, by, Math.round(8 * ready) * ART, ART);
        // While carrying: a pointer toward your beacon.
        if (carry > 0) {
          const [sx, sy] = SHRINES[a.slot % SHRINES.length];
          const ang = Math.atan2(sy - pos.y, sx - pos.x);
          if (Math.hypot(sx - pos.x, sy - pos.y) > 90) {
            for (let i = 0; i < 3; i++) {
              const r = 44 + i * ART * 1.5;
              o.fillStyle(i === 2 ? hexNum(k.cloak) : LAMP_L, 1).fillRect(snap(pos.x + Math.cos(ang) * r), snap(pos.y + Math.sin(ang) * r), ART, ART);
            }
          }
        }
      }
    }

    // Glints running along the mirrors.
    let i = 0;
    for (const seg of OBSTACLES) {
      if (seg.kind !== 'mirror') continue;
      const t = ((now / 2400 + i * 0.37) % 1.8) - 0.4;
      i++;
      if (t < 0 || t > 1) continue;
      o.fillStyle(LAMP_L, 1).fillRect(snap(seg.ax + (seg.bx - seg.ax) * t), snap(seg.ay + (seg.by - seg.ay) * t), ART, ART);
    }
  }

  private drawBeacons(now: number) {
    for (const b of this.beacons) {
      const slot = this.session.slotOf(b.uid);
      const [x, y] = SHRINES[slot % SHRINES.length];
      const score = this.session.state.score[b.uid] ?? 0;
      if (Math.floor(now / 160 + slot) % 7 !== 0) this.lightAt('light-beacon', x, y - 24, 18);
      b.label.setText(b.uid === this.uid && !this.quiet ? 'YOUR BEACON' : this.nameOf(b.uid));
      const o = this.overlay;
      const cells = TUNING.winScore;
      const step = ART + 2;
      const total = cells * step - 2;
      const gx = snap(x - total / 2);
      const gy = y + 50;
      const near = score >= cells - 3 && Math.floor(now / 250) % 2 === 0;
      o.fillStyle(near ? hexNum(P.rust) : INK, 1).fillRect(gx - ART, gy - ART, total + ART * 2, ART * 4);
      for (let i = 0; i < cells; i++) {
        o.fillStyle(i < score ? hexNum(keeperOf(slot).cloak) : hexNum(P.ink2), 1).fillRect(gx + i * step, gy, ART, ART * 2);
        if (i < score) o.fillStyle(LAMP_L, 1).fillRect(gx + i * step, gy, ART, 2);
      }
    }
  }

  private drawUi(now: number) {
    const g = this.ui;
    g.clear();
    if (!this.touch || this.quiet) return;
    const box = (x: number, y: number, size: number, color: number, alpha: number) => {
      g.lineStyle(ART, color, alpha).strokeRect(snap(x - size / 2), snap(y - size / 2), size, size);
    };
    for (const [stick, color] of [[this.moveStick, hexNum(P.parchment)], [this.aimStick, hexNum(P.lamp)]] as const) {
      if (!stick) continue;
      const dx = stick.x - stick.bx;
      const dy = stick.y - stick.by;
      const len = Math.hypot(dx, dy);
      const k = len > 60 ? 60 / len : 1;
      box(stick.bx, stick.by, 128, color, 0.55);
      g.fillStyle(color, 0.8).fillRect(snap(stick.bx + dx * k) - 20, snap(stick.by + dy * k) - 20, 40, 40);
    }
    if (!this.moveStick && !this.aimStick && now < (this.session.match?.startsAt ?? 0) + 8000) {
      box(160, H - 140, 128, hexNum(P.parchment), 0.35);
      box(W - 160, H - 140, 128, hexNum(P.lamp), 0.35);
    }
  }
}
