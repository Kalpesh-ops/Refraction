import Phaser from 'phaser';
import { serverNow } from '../firebase';
import { panFor, sfx } from '../audio/sfx';
import type { Session } from '../net/session';
import type { Hit, PosSample, Shot } from '../types';
import { H, OBSTACLES, PLAYER_COLORS, SHRINES, SPAWNS, TUNING, W } from './constants';
import { dist, pointAt, resolveCircle, sweepHits, traceBolt, type BoltPath, type Vec } from './geometry';
import type { ArenaState } from './host';

const FLOOR_SHADER = `
precision mediump float;
uniform float time;
uniform vec2 resolution;
varying vec2 fragCoord;

float caustic(vec2 p, float t) {
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.006), p.y / (cos(i.y + tt) / 0.006)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 7.0);
}

void main() {
  vec2 uv = fragCoord / resolution;
  vec2 p = (fragCoord - 0.5 * resolution) / resolution.y;
  float t = time * 0.3;
  float c = 1.0 - clamp(caustic(p * 5.0 + vec2(17.0, 9.0), t), 0.0, 1.0);
  c = c * c;
  vec2 hex = p * vec2(9.0, 10.4);
  hex.x += step(1.0, mod(hex.y, 2.0)) * 0.5;
  vec2 g = fract(hex) - 0.5;
  float cell = smoothstep(0.46, 0.5, max(abs(g.x) * 1.15 + abs(g.y) * 0.58, abs(g.y) * 1.15));
  float pulse = 0.5 + 0.5 * sin(time * 0.8 - length(p) * 7.0);
  vec3 base = mix(vec3(0.015, 0.035, 0.05), vec3(0.03, 0.07, 0.095), uv.y);
  vec3 col = base;
  col += vec3(0.05, 0.42, 0.46) * c * 0.28;
  col += vec3(0.08, 0.3, 0.36) * cell * (0.05 + 0.05 * pulse);
  float ring = smoothstep(0.012, 0.0, abs(length(p) - 0.2 - 0.02 * sin(time)));
  col += vec3(0.2, 0.7, 0.75) * ring * 0.18;
  col *= smoothstep(1.25, 0.25, length(p * vec2(0.9, 1.2)));
  gl_FragColor = vec4(col, 1.0);
}`;

interface Bolt {
  id: string;
  owner: string;
  echo: boolean;
  t0: number;
  path: BoltPath;
  color: number;
  stopD: number | null;
  checkedD: number;
  nextBounce: number;
  started: boolean;
  ended: boolean;
}

interface Avatar {
  glow: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  aim: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  echo: Phaser.GameObjects.Image;
  color: number;
}

interface Stick { id: number; bx: number; by: number; x: number; y: number }

const colorOf = (slot: number) => Phaser.Display.Color.HexStringToColor(PLAYER_COLORS[slot % PLAYER_COLORS.length]).color;
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
  private session!: Session;
  private uid = '';
  private webgl = false;
  private touch = false;

  private round = -1;
  private me = { x: 0, y: 0, aim: 0, vx: 0, vy: 0, stunnedUntil: 0, immuneUntil: 0, lastFire: 0 };
  private history: PosSample[] = [];
  private bolts = new Map<string, Bolt>();
  private avatars = new Map<string, Avatar>();
  private shardSprites = new Map<string, Phaser.GameObjects.Image>();
  private predicted = new Map<string, number>();
  private shrineSprites: Phaser.GameObjects.Image[] = [];
  private shrineLabel?: Phaser.GameObjects.Text;
  private prevState?: ArenaState;
  private lastCount = -1;
  private lastPickupSound = 0;

  private boltGfx!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private ui!: Phaser.GameObjects.Graphics;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private sparks!: Phaser.GameObjects.Particles.ParticleEmitter;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private moveStick: Stick | null = null;
  private aimStick: Stick | null = null;
  private mouse = { x: W / 2, y: H / 2, down: false, active: false };
  private fireQueued = false;

  constructor() { super('arena'); }

  init(data: { session: Session }) {
    this.session = data.session;
    this.uid = data.session.uid;
  }

  create() {
    this.webgl = this.game.renderer.type === Phaser.WEBGL;
    this.touch = this.sys.game.device.input.touch && window.matchMedia('(pointer: coarse)').matches;
    this.makeTextures();

    if (this.webgl) {
      this.cache.shader.add('floor', new Phaser.Display.BaseShader('floor', FLOOR_SHADER));
      this.add.shader('floor', W / 2, H / 2, W, H).setDepth(-10);
      if (!this.touch) this.cameras.main.postFX.addBloom(0xffffff, 1, 1, 1, 1.05, 4);
    } else {
      this.add.rectangle(W / 2, H / 2, W, H, 0x071219).setDepth(-10);
    }

    this.drawWalls();
    this.boltGfx = this.add.graphics().setDepth(5).setBlendMode(Phaser.BlendModes.ADD);
    this.overlay = this.add.graphics().setDepth(8);
    this.ui = this.add.graphics().setDepth(20);
    this.burst = this.add.particles(0, 0, 'dot', {
      lifespan: { min: 280, max: 700 }, speed: { min: 60, max: 320 }, scale: { start: 0.7, end: 0 },
      alpha: { start: 1, end: 0 }, blendMode: 'ADD', emitting: false,
    }).setDepth(9);
    this.sparks = this.add.particles(0, 0, 'spark', {
      lifespan: { min: 120, max: 320 }, speed: { min: 90, max: 260 }, scale: { start: 0.9, end: 0.1 },
      alpha: { start: 1, end: 0 }, rotate: { min: 0, max: 360 }, blendMode: 'ADD', emitting: false,
    }).setDepth(9);

    this.setupInput();
    this.session.onShot = (id, shot) => this.addShot(id, shot);
    this.session.onHit = (id, hit) => this.handleHit(id, hit);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.session.onShot = undefined; this.session.onHit = undefined; });
  }

  // ---------- textures ----------

  private makeTextures() {
    const g = this.make.graphics({}, false);
    const radial = (key: string, size: number, steps: number, power: number) => {
      g.clear();
      for (let i = steps; i > 0; i--) {
        const k = i / steps;
        g.fillStyle(0xffffff, Math.pow(1 - k, power) * 0.9 + 0.02);
        g.fillCircle(size / 2, size / 2, (size / 2) * k);
      }
      g.generateTexture(key, size, size);
    };
    radial('orb', 96, 24, 2.2);
    radial('dot', 24, 8, 1.4);

    g.clear();
    g.fillStyle(0xffffff, 1).fillCircle(22, 22, 18);
    g.lineStyle(3, 0xffffff, 0.6).strokeCircle(22, 22, 21);
    g.generateTexture('core', 44, 44);

    g.clear();
    g.fillStyle(0xffffff, 1).fillTriangle(0, 0, 14, 7, 0, 14);
    g.generateTexture('arrow', 14, 14);

    g.clear();
    g.fillStyle(0xffffff, 1).fillRect(0, 1, 10, 2);
    g.generateTexture('spark', 10, 4);

    g.clear();
    g.fillStyle(0xffffff, 0.95).fillPoints([{ x: 14, y: 0 }, { x: 26, y: 14 }, { x: 14, y: 30 }, { x: 2, y: 14 }], true);
    g.fillStyle(0x9ffcf0, 0.9).fillPoints([{ x: 14, y: 4 }, { x: 20, y: 14 }, { x: 14, y: 24 }], true);
    g.generateTexture('shard', 28, 30);

    g.clear();
    g.lineStyle(3, 0xffffff, 0.9).strokeCircle(60, 60, 54);
    g.lineStyle(1.5, 0xffffff, 0.5).strokeCircle(60, 60, 44);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.lineStyle(i % 3 === 0 ? 3 : 1.5, 0xffffff, 0.8);
      g.lineBetween(60 + Math.cos(a) * 44, 60 + Math.sin(a) * 44, 60 + Math.cos(a) * (i % 3 === 0 ? 58 : 51), 60 + Math.sin(a) * (i % 3 === 0 ? 58 : 51));
    }
    g.generateTexture('rune', 120, 120);
    g.destroy();
  }

  private drawWalls() {
    const stone = this.add.graphics().setDepth(0);
    const mirror = this.add.graphics().setDepth(0).setBlendMode(Phaser.BlendModes.ADD);
    const capsule = (gfx: Phaser.GameObjects.Graphics, s: typeof OBSTACLES[number], w: number, color: number, alpha: number) => {
      gfx.lineStyle(w, color, alpha).lineBetween(s.ax, s.ay, s.bx, s.by);
      gfx.fillStyle(color, alpha).fillCircle(s.ax, s.ay, w / 2).fillCircle(s.bx, s.by, w / 2);
    };
    for (const s of OBSTACLES) {
      if (s.kind === 'stone') {
        capsule(stone, s, s.h * 2 + 6, 0x02080b, 0.6);
        capsule(stone, s, s.h * 2, 0x1a2d36, 1);
        capsule(stone, s, s.h * 2 - 6, 0x243c47, 1);
      } else {
        capsule(mirror, s, 18, 0x2de2d0, 0.1);
        capsule(mirror, s, 8, 0x6ff6e8, 0.45);
        capsule(mirror, s, 2.5, 0xffffff, 0.95);
      }
    }
    const frame = this.add.graphics().setDepth(0).setBlendMode(Phaser.BlendModes.ADD);
    frame.lineStyle(10, 0x2de2d0, 0.08).strokeRect(4, 4, W - 8, H - 8);
    frame.lineStyle(2, 0x8ff8ee, 0.6).strokeRect(2, 2, W - 4, H - 4);
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
        const len = Math.hypot(s.x - s.bx, s.y - s.by);
        if (len > 14) this.me.aim = Math.atan2(s.y - s.by, s.x - s.bx);
        else this.me.aim = this.autoAim() ?? this.me.aim;
        this.fireQueued = true;
        this.aimStick = null;
      }
      if (!p.wasTouch) this.mouse.down = false;
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
  }

  /** For taps: aim at the nearest visible rival. */
  private autoAim(): number | null {
    let best: Vec | null = null;
    let bestD = Infinity;
    for (const [uid] of this.avatars) {
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
    const x = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const y = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  }

  // ---------- bolts & hits ----------

  private addShot(id: string, shot: Shot) {
    const slot = this.session.slotOf(shot.o);
    const path = traceBolt(shot.x, shot.y, shot.a);
    const color = colorOf(slot);
    const base = { owner: shot.o, path, color, stopD: null, checkedD: 0, nextBounce: 1, started: false, ended: false };
    this.bolts.set(id, { ...base, id, echo: false, t0: shot.t });
    this.bolts.set(`${id}~e`, { ...base, id: `${id}~e`, echo: true, t0: shot.t + TUNING.echoDelayMs });
  }

  private boltD(b: Bolt, now: number) {
    const d = ((now - b.t0) * TUNING.boltSpeed) / 1000;
    return Math.min(d, b.stopD ?? b.path.length);
  }

  private handleHit(_id: string, hit: Hit) {
    const b = this.bolts.get(hit.echo ? `${hit.sid}~e` : hit.sid);
    if (b && b.stopD === null) b.stopD = this.boltD(b, serverNow());
    if (hit.v === this.uid) return;
    const color = colorOf(this.session.slotOf(hit.v));
    this.burst.setParticleTint(color);
    this.burst.explode(28, hit.x, hit.y);
    this.sparks.setParticleTint(0xffffff);
    this.sparks.explode(14, hit.x, hit.y);
    sfx.hit(panFor(hit.x));
    if (hit.by === this.uid) {
      this.floater(hit.x, hit.y - 30, 'STUNNED', '#ffffff');
      this.cameras.main.shake(90, 0.003);
    }
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
    this.cameras.main.shake(220, 0.012);
    this.cameras.main.flash(140, 255, 90, 70);
    const color = colorOf(this.session.slotOf(this.uid));
    this.burst.setParticleTint(color);
    this.burst.explode(34, this.me.x, this.me.y);
    sfx.hit(0);
    sfx.stunned();
    const carrying = (this.session.state.carry[this.uid] ?? 0) + this.predicted.size;
    if (carrying > 0) { sfx.drop(); this.floater(this.me.x, this.me.y - 34, `-${carrying}`, '#ff8a70'); }
    this.predicted.clear();
  }

  private fire(now: number) {
    this.me.lastFire = now;
    const shot = { x: Math.round(this.me.x), y: Math.round(this.me.y), a: Math.round(this.me.aim * 1000) / 1000, t: now };
    const id = this.session.fire(shot);
    this.addShot(id, { ...shot, o: this.uid });
    const color = colorOf(this.session.slotOf(this.uid));
    this.sparks.setParticleTint(color);
    this.sparks.explode(8, this.me.x + Math.cos(this.me.aim) * 22, this.me.y + Math.sin(this.me.aim) * 22);
    sfx.fire(panFor(this.me.x), true);
  }

  // ---------- helpers ----------

  private floater(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y, text, { fontFamily: 'Space Grotesk, system-ui, sans-serif', fontSize: '22px', fontStyle: '700', color, stroke: '#031015', strokeThickness: 5 }).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: t, y: y - 42, alpha: 0, duration: 900, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private remotePos(uid: string, delay = TUNING.interpDelayMs): PosSample | undefined {
    const buf = this.session.positions.get(uid);
    return buf ? sampleAt(buf, serverNow() - delay) : undefined;
  }

  private avatar(uid: string, slot: number, name: string): Avatar {
    let a = this.avatars.get(uid);
    if (a) return a;
    const color = colorOf(slot);
    a = {
      echo: this.add.image(0, 0, 'core').setTint(color).setAlpha(0.28).setScale(0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(4),
      glow: this.add.image(0, 0, 'orb').setTint(color).setAlpha(0.8).setScale(1.25).setBlendMode(Phaser.BlendModes.ADD).setDepth(6),
      core: this.add.image(0, 0, 'core').setTint(color).setDepth(6),
      aim: this.add.image(0, 0, 'arrow').setTint(color).setOrigin(0, 0.5).setDepth(6),
      label: this.add.text(0, 0, name, { fontFamily: 'Space Grotesk, system-ui, sans-serif', fontSize: '14px', fontStyle: '700', color: '#e8fffb', stroke: '#031015', strokeThickness: 4 }).setOrigin(0.5, 0).setDepth(7),
      color,
    };
    this.avatars.set(uid, a);
    return a;
  }

  private resetRound(round: number) {
    this.round = round;
    const slot = this.session.slotOf(this.uid);
    const [x, y] = SPAWNS[slot % SPAWNS.length];
    const [sx, sy] = SHRINES[slot % SHRINES.length];
    this.me = { x, y, aim: Math.atan2(360 - y, 640 - x), vx: 0, vy: 0, stunnedUntil: 0, immuneUntil: 0, lastFire: 0 };
    this.history = [];
    this.bolts.clear();
    this.predicted.clear();
    this.prevState = undefined;
    this.shrineKey = '';
    this.shrineLabel?.destroy();
    this.shrineLabel = this.add.text(sx, sy + (sy < H / 2 ? 62 : -62), 'YOUR SHRINE', { fontFamily: 'Space Grotesk, system-ui, sans-serif', fontSize: '13px', fontStyle: '700', color: '#ffffff', stroke: '#031015', strokeThickness: 4 }).setOrigin(0.5).setDepth(12);
    this.tweens.add({ targets: this.shrineLabel, alpha: 0.25, duration: 600, yoyo: true, repeat: 8, onComplete: () => this.shrineLabel?.setAlpha(0) });
  }

  private shrineKey = '';
  private buildShrines() {
    const uids = Object.keys(this.session.state.score).sort();
    const key = uids.map((u) => `${u}:${this.session.slotOf(u)}`).join('|');
    if (key === this.shrineKey) return;
    this.shrineKey = key;
    this.shrineSprites.forEach((s) => s.destroy());
    this.shrineSprites = [];
    for (const uid of uids) {
      const s = this.session.slotOf(uid);
      const [px, py] = SHRINES[s % SHRINES.length];
      const color = colorOf(s);
      this.shrineSprites.push(this.add.image(px, py, 'orb').setTint(color).setAlpha(0.35).setScale(1.3).setBlendMode(Phaser.BlendModes.ADD).setDepth(1));
      this.shrineSprites.push(this.add.image(px, py, 'rune').setTint(color).setAlpha(uid === this.uid ? 0.95 : 0.55).setScale(0.82).setDepth(1).setData('spin', uid === this.uid ? 0.8 : 0.3));
    }
  }

  // ---------- frame ----------

  update(_time: number, delta: number) {
    const s = this.session;
    const match = s.match;
    if (!match || !s.meta) return;
    const now = serverNow();
    const dt = Math.min(delta, 50) / 1000;
    if (match.round !== this.round) this.resetRound(match.round);
    this.buildShrines();

    const playing = this.uid in s.state.score;
    const live = now >= match.startsAt && now < match.endsAt;
    const stunned = now < this.me.stunnedUntil;

    // Countdown beeps.
    const count = Math.ceil((match.startsAt - now) / 1000);
    if (count !== this.lastCount && count >= 0 && count <= 3) { sfx.countdown(count === 0); this.lastCount = count; }

    // --- local simulation (prediction: our own runner never waits for the network) ---
    if (playing) {
      const carry = (s.state.carry[this.uid] ?? 0) + this.predicted.size;
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

      if (this.aimStick) {
        const dx = this.aimStick.x - this.aimStick.bx;
        const dy = this.aimStick.y - this.aimStick.by;
        if (Math.hypot(dx, dy) > 14) this.me.aim = Math.atan2(dy, dx);
      } else if (!this.touch && this.mouse.active) {
        this.me.aim = Math.atan2(this.mouse.y - this.me.y, this.mouse.x - this.me.x);
      }

      const wantsFire = this.fireQueued || this.mouse.down || this.keys.SPACE.isDown;
      this.fireQueued = false;
      if (wantsFire && live && !stunned && now - this.me.lastFire >= TUNING.fireCooldownMs) this.fire(now);

      const sample: PosSample = { x: Math.round(this.me.x * 10) / 10, y: Math.round(this.me.y * 10) / 10, a: Math.round(this.me.aim * 100) / 100, t: now, s: this.me.stunnedUntil };
      this.history.push(sample);
      while (this.history.length > 2 && this.history[0].t < now - TUNING.echoDelayMs - 500) this.history.shift();
      s.localPos = sample;
      s.publishPos(sample);
    }

    this.updateBolts(now, live && playing);
    this.syncShards(now, live && playing);
    this.diffState(now);
    this.drawPlayers(now);
    this.drawUi(now);
    for (const img of this.shrineSprites) if (img.getData('spin')) img.rotation += dt * img.getData('spin');
  }

  private updateBolts(now: number, canBeHit: boolean) {
    const g = this.boltGfx;
    g.clear();
    const immune = now < this.me.immuneUntil;
    for (const [id, b] of this.bolts) {
      if (now < b.t0) continue;
      const d = this.boltD(b, now);
      const end = b.stopD ?? b.path.length;
      if (((now - b.t0) * TUNING.boltSpeed) / 1000 > end + 170) { this.bolts.delete(id); continue; }

      if (!b.started) {
        b.started = true;
        if (b.echo) {
          const o = b.path.points[0];
          this.burst.setParticleTint(b.color);
          this.burst.explode(10, o.x, o.y);
          sfx.echoFire(panFor(o.x));
        } else if (b.owner !== this.uid) {
          sfx.fire(panFor(b.path.points[0].x), false);
        }
      }

      if (canBeHit && !immune && b.owner !== this.uid && b.stopD === null && d > b.checkedD) {
        if (sweepHits(b.path, b.checkedD, d, this.me, TUNING.runnerRadius + TUNING.boltRadius)) this.gotHit(b, d, now);
      }
      b.checkedD = d;

      while (b.nextBounce < b.path.points.length - 1 && b.path.cum[b.nextBounce] <= d) {
        const p = b.path.points[b.nextBounce];
        this.sparks.setParticleTint(b.color);
        this.sparks.explode(b.echo ? 3 : 6, p.x, p.y);
        if (!b.echo) sfx.bounce(panFor(p.x));
        b.nextBounce++;
      }
      if (!b.ended && d >= b.path.length && b.stopD === null) {
        b.ended = true;
        const p = b.path.points[b.path.points.length - 1];
        this.sparks.setParticleTint(b.path.end === 'stone' ? 0xffc9a0 : b.color);
        this.sparks.explode(8, p.x, p.y);
        if (b.path.end === 'stone') sfx.absorb(panFor(p.x));
      }

      const tail = Math.max(0, d - (b.echo ? 110 : 160));
      const pts: Vec[] = [pointAt(b.path, tail)];
      for (let i = 1; i < b.path.points.length - 1; i++) if (b.path.cum[i] > tail && b.path.cum[i] < d) pts.push(b.path.points[i]);
      pts.push(pointAt(b.path, d));
      const fade = Math.max(0, 1 - (((now - b.t0) * TUNING.boltSpeed) / 1000 - end) / 170);
      const k = (b.echo ? 0.55 : 1) * fade;
      g.lineStyle(b.echo ? 7 : 11, b.color, 0.16 * k).strokePoints(pts);
      g.lineStyle(b.echo ? 3 : 4.5, b.color, 0.8 * k).strokePoints(pts);
      g.lineStyle(b.echo ? 1 : 1.8, 0xffffff, 0.95 * k).strokePoints(pts);
      const head = pts[pts.length - 1];
      if (d < end) {
        g.fillStyle(b.color, 0.45 * k).fillCircle(head.x, head.y, b.echo ? 6 : 9);
        g.fillStyle(0xffffff, 0.95 * k).fillCircle(head.x, head.y, b.echo ? 2.5 : 3.5);
      }
    }
  }

  private syncShards(now: number, canPick: boolean) {
    const shards = this.session.state.shards;
    for (const [id, sprite] of this.shardSprites) {
      if (!(id in shards)) {
        if (!this.predicted.has(id)) { this.sparks.setParticleTint(0x9ffcf0); this.sparks.explode(6, sprite.x, sprite.y); }
        sprite.destroy();
        this.shardSprites.delete(id);
        this.predicted.delete(id);
      }
    }
    const carry = this.session.state.carry[this.uid] ?? 0;
    for (const [id, shard] of Object.entries(shards)) {
      let sprite = this.shardSprites.get(id);
      if (!sprite) {
        const size = this.touch ? 1.35 : 1.1;
        sprite = this.add.image(shard.x, shard.y, 'shard').setDepth(2).setScale(0).setTint(0xc8fff8);
        const glow = this.add.image(shard.x, shard.y, 'orb').setDepth(2).setScale(0).setTint(0x3ee8d4).setAlpha(0.55).setBlendMode(Phaser.BlendModes.ADD);
        sprite.setData('glow', glow);
        sprite.once(Phaser.GameObjects.Events.DESTROY, () => glow.destroy());
        this.tweens.add({ targets: sprite, scale: size, duration: 380, ease: 'Back.easeOut' });
        this.tweens.add({ targets: glow, scale: 0.55 * size, duration: 380, ease: 'Back.easeOut' });
        this.shardSprites.set(id, sprite);
      }
      const locked = shard.lockUid === this.uid && now < (shard.lockUntil ?? 0);
      const bob = Math.sin(now / 320 + shard.x * 0.05) * 3;
      sprite.setPosition(shard.x, shard.y + bob);
      sprite.rotation = Math.sin(now / 600 + shard.y) * 0.25;
      const glow = sprite.getData('glow') as Phaser.GameObjects.Image | undefined;
      glow?.setPosition(shard.x, shard.y + bob).setVisible(sprite.visible).setAlpha((locked ? 0.15 : 0.45) + 0.15 * Math.sin(now / 250 + shard.x));

      const predictedAt = this.predicted.get(id);
      if (predictedAt !== undefined) {
        sprite.setVisible(false);
        if (now - predictedAt > 900) { this.predicted.delete(id); sprite.setVisible(true); }
        continue;
      }
      sprite.setVisible(true).setAlpha(locked ? 0.3 + 0.2 * Math.sin(now / 60) : 1);
      const held = carry + this.predicted.size;
      if (canPick && !locked && now >= this.me.stunnedUntil && held < TUNING.carryMax && dist(this.me, shard) < TUNING.pickupRadius) {
        this.predicted.set(id, now);
        sprite.setVisible(false);
        this.sparks.setParticleTint(0x9ffcf0);
        this.sparks.explode(10, shard.x, shard.y);
        sfx.pickup(held + 1, panFor(shard.x));
        this.lastPickupSound = now;
      }
    }
  }

  /** Turns shared-state changes into effects: banks, confirmed pickups. */
  private diffState(now: number) {
    const state = this.session.state;
    const prev = this.prevState;
    if (prev === state) return;
    this.prevState = state;
    if (!prev) return;
    for (const [uid, score] of Object.entries(state.score)) {
      const gained = score - (prev.score[uid] ?? 0);
      if (gained <= 0) continue;
      const [x, y] = SHRINES[this.session.slotOf(uid) % SHRINES.length];
      const color = colorOf(this.session.slotOf(uid));
      this.burst.setParticleTint(color);
      this.burst.explode(22 + gained * 8, x, y);
      this.sparks.setParticleTint(0xffffff);
      this.sparks.explode(16, x, y);
      this.floater(x, y - 20, `+${gained}`, uid === this.uid ? '#ffffff' : PLAYER_COLORS[this.session.slotOf(uid) % PLAYER_COLORS.length]);
      sfx.bank(gained, uid === this.uid, panFor(x));
      if (uid === this.uid) this.cameras.main.flash(120, 120, 255, 230);
    }
    const mine = state.carry[this.uid] ?? 0;
    if (mine > (prev.carry[this.uid] ?? 0) && now - this.lastPickupSound > 600) sfx.pickup(mine, 0);
  }

  private drawPlayers(now: number) {
    const s = this.session;
    const o = this.overlay;
    o.clear();
    const participants = Object.keys(s.state.score);
    for (const uid of participants) {
      const player = s.meta!.players[uid];
      if (!player) continue;
      const a = this.avatar(uid, player.slot, player.name);
      const mine = uid === this.uid;
      const pos = mine ? s.localPos : this.remotePos(uid);
      const echoPos = mine ? sampleAt(this.history, now - TUNING.echoDelayMs) : this.remotePos(uid, TUNING.echoDelayMs);
      const visible = Boolean(pos);
      [a.glow, a.core, a.aim, a.label].forEach((obj) => obj.setVisible(visible));
      a.echo.setVisible(Boolean(echoPos) && now > (s.match?.startsAt ?? 0));
      if (echoPos) a.echo.setPosition(echoPos.x, echoPos.y).setAlpha(0.18 + 0.08 * Math.sin(now / 200));
      if (!pos) continue;

      const stunned = now < pos.s;
      const immune = mine && now < this.me.immuneUntil && !stunned;
      const faded = !player.connected ? 0.35 : 1;
      const blink = stunned ? (Math.floor(now / 70) % 2 ? 0.35 : 1) : immune ? (Math.floor(now / 110) % 2 ? 0.55 : 1) : 1;
      a.glow.setPosition(pos.x, pos.y).setAlpha((mine ? 0.95 : 0.75) * faded * blink).setScale(1.2 + 0.06 * Math.sin(now / 180));
      a.core.setPosition(pos.x, pos.y).setAlpha(faded * blink).setScale(stunned ? 0.78 : 0.86);
      a.aim.setPosition(pos.x + Math.cos(pos.a) * 24, pos.y + Math.sin(pos.a) * 24).setRotation(pos.a).setAlpha(stunned ? 0.2 : 0.9 * faded);
      a.label.setPosition(pos.x, pos.y + 26).setAlpha(faded);

      if (mine) {
        o.lineStyle(2, 0xffffff, 0.9).strokeCircle(pos.x, pos.y, 25 + Math.sin(now / 160) * 1.5);
        // Aim preview: the first stretch of the bolt path, so bank shots are readable.
        if (!stunned && (!this.touch || this.aimStick)) {
          const path = traceBolt(pos.x, pos.y, pos.a);
          const reach = Math.min(path.length, this.touch ? 520 : 300);
          const pts: Vec[] = [path.points[0]];
          for (let i = 1; i < path.points.length - 1 && path.cum[i] < reach; i++) pts.push(path.points[i]);
          pts.push(pointAt(path, reach));
          o.lineStyle(1.5, a.color, 0.35).strokePoints(pts);
        }
        const ready = Math.min(1, (now - this.me.lastFire) / TUNING.fireCooldownMs);
        if (ready < 1) o.lineStyle(3, a.color, 0.9).beginPath().arc(pos.x, pos.y, 31, -Math.PI / 2, -Math.PI / 2 + ready * Math.PI * 2).strokePath();
      }

      if (stunned) {
        for (let i = 0; i < 3; i++) {
          const ang = now / 150 + (i * Math.PI * 2) / 3;
          o.fillStyle(0xfff3a0, 0.9).fillCircle(pos.x + Math.cos(ang) * 22, pos.y - 26 + Math.sin(ang) * 6, 3);
        }
      }

      const carry = (s.state.carry[uid] ?? 0) + (mine ? this.predicted.size : 0);
      for (let i = 0; i < carry; i++) {
        const ang = now / 400 + (i * Math.PI * 2) / carry;
        const cx = pos.x + Math.cos(ang) * 34;
        const cy = pos.y + Math.sin(ang) * 34;
        o.fillStyle(0x9ffcf0, 0.95).fillPoints([{ x: cx, y: cy - 6 }, { x: cx + 4.5, y: cy }, { x: cx, y: cy + 6 }, { x: cx - 4.5, y: cy }], true);
      }
    }

    // Mirror glints.
    let i = 0;
    for (const seg of OBSTACLES) {
      if (seg.kind !== 'mirror') continue;
      const k = ((now / 2600 + i * 0.37) % 1.6) - 0.3;
      i++;
      if (k < 0 || k > 1) continue;
      o.fillStyle(0xffffff, 0.8 * Math.sin(k * Math.PI)).fillCircle(seg.ax + (seg.bx - seg.ax) * k, seg.ay + (seg.by - seg.ay) * k, 3);
    }
  }

  private drawUi(now: number) {
    const g = this.ui;
    g.clear();
    if (!this.touch) return;
    for (const [stick, color] of [[this.moveStick, 0x9ffcf0], [this.aimStick, 0xffd35c]] as const) {
      if (!stick) continue;
      const dx = stick.x - stick.bx;
      const dy = stick.y - stick.by;
      const len = Math.hypot(dx, dy);
      const k = len > 60 ? 60 / len : 1;
      g.lineStyle(2, color, 0.4).strokeCircle(stick.bx, stick.by, 60);
      g.fillStyle(color, 0.12).fillCircle(stick.bx, stick.by, 60);
      g.fillStyle(color, 0.55).fillCircle(stick.bx + dx * k, stick.by + dy * k, 24);
    }
    if (!this.moveStick && !this.aimStick && now < (this.session.match?.startsAt ?? 0) + 6000) {
      g.lineStyle(2, 0x9ffcf0, 0.25).strokeCircle(150, H - 130, 60);
      g.lineStyle(2, 0xffd35c, 0.25).strokeCircle(W - 150, H - 130, 60);
    }
  }
}
