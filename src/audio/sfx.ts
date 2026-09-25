// Procedural sound: every effect is synthesised with Web Audio, so the game ships no audio files.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let music: { stop: () => void } | null = null;

const MUTE_KEY = 'refraction:muted';
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp).connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.18;
      musicGain.connect(master);
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* audio is optional */ }
}

export const isMuted = () => muted;
export function setMuted(value: boolean) {
  muted = value;
  try { localStorage.setItem(MUTE_KEY, value ? '1' : '0'); } catch { /* ignore */ }
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 0.55, ctx.currentTime, 0.02);
}

interface Tone { type?: OscillatorType; f0: number; f1?: number; dur: number; vol?: number; delay?: number; attack?: number; pan?: number; lowpass?: number; out?: AudioNode | null }

function tone({ type = 'sine', f0, f1 = f0, dur, vol = 0.3, delay = 0, attack = 0.004, pan = 0, lowpass, out }: Tone) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = osc.connect(gain);
  if (lowpass) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lowpass; node = node.connect(f); }
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
  node.connect(out ?? master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noise(dur: number, vol: number, freq: number, q = 1, delay = 0, pan = 0) {
  if (!ctx || !master || !noiseBuffer) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = src.connect(filter).connect(gain);
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
  node.connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** Maps an arena x coordinate to stereo pan. */
export const panFor = (x: number) => Math.max(-0.8, Math.min(0.8, (x / 1280) * 1.6 - 0.8));

export const sfx = {
  fire(pan = 0, mine = true) {
    tone({ type: 'sawtooth', f0: 1500, f1: 260, dur: 0.16, vol: mine ? 0.13 : 0.07, pan, lowpass: 3800 });
    tone({ type: 'sine', f0: 2400, f1: 900, dur: 0.08, vol: mine ? 0.1 : 0.05, pan });
  },
  echoFire(pan = 0) {
    tone({ type: 'triangle', f0: 900, f1: 180, dur: 0.28, vol: 0.08, pan, lowpass: 1600 });
    tone({ type: 'sine', f0: 1350, f1: 300, dur: 0.22, vol: 0.04, pan, delay: 0.06 });
  },
  bounce(pan = 0) {
    tone({ type: 'sine', f0: 2600 + Math.random() * 600, f1: 1800, dur: 0.07, vol: 0.035, pan });
  },
  absorb(pan = 0) { noise(0.12, 0.06, 900, 2, 0, pan); },
  hit(pan = 0) {
    noise(0.3, 0.35, 2400, 0.8, 0, pan);
    tone({ type: 'square', f0: 220, f1: 55, dur: 0.35, vol: 0.18, pan, lowpass: 900 });
  },
  stunned() {
    tone({ type: 'sine', f0: 700, f1: 120, dur: 0.6, vol: 0.2 });
    tone({ type: 'triangle', f0: 1100, f1: 300, dur: 0.45, vol: 0.08, delay: 0.05 });
  },
  pickup(count: number, pan = 0) {
    const base = 660 * Math.pow(1.122, count);
    tone({ type: 'sine', f0: base, f1: base * 1.5, dur: 0.12, vol: 0.14, pan });
    tone({ type: 'triangle', f0: base * 2, f1: base * 2.2, dur: 0.1, vol: 0.05, delay: 0.03, pan });
  },
  bank(amount: number, mine: boolean, pan = 0) {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    const vol = mine ? 0.16 : 0.07;
    for (let i = 0; i < Math.min(notes.length, amount + 1); i++) {
      tone({ type: 'triangle', f0: notes[i], dur: 0.4, vol, delay: i * 0.06, pan });
      tone({ type: 'sine', f0: notes[i] * 2, dur: 0.25, vol: vol * 0.4, delay: i * 0.06 + 0.02, pan });
    }
  },
  cast(pan = 0) {
    tone({ type: 'sine', f0: 320, f1: 1400, dur: 0.5, vol: 0.06, pan, lowpass: 2600 });
    tone({ type: 'triangle', f0: 1900, f1: 2400, dur: 0.18, vol: 0.03, delay: 0.42, pan });
  },
  drop(pan = 0) {
    for (let i = 0; i < 4; i++) tone({ type: 'sine', f0: 1500 - i * 220, f1: 700 - i * 100, dur: 0.12, vol: 0.06, delay: i * 0.04, pan });
  },
  countdown(go: boolean) {
    if (go) { tone({ type: 'square', f0: 880, dur: 0.35, vol: 0.12, lowpass: 3000 }); tone({ type: 'sine', f0: 1760, dur: 0.4, vol: 0.08 }); }
    else tone({ type: 'square', f0: 440, dur: 0.12, vol: 0.1, lowpass: 2000 });
  },
  end() {
    [392, 523.25, 659.25, 783.99].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.7, vol: 0.12, delay: i * 0.11 }));
  },
  ui() { tone({ type: 'sine', f0: 900, f1: 1300, dur: 0.07, vol: 0.06 }); },
};

/** Low ambient pad with a slow filter sweep and a sparse arpeggio. */
export function startMusic() {
  if (!ctx || !musicGain || music) return;
  const c = ctx;
  const out = musicGain;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 4;
  filter.connect(out);
  const lfo = c.createOscillator();
  const lfoGain = c.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 380;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();
  const pads = [55, 82.41, 110, 164.81].map((f, i) => {
    const o = c.createOscillator();
    o.type = i % 2 ? 'triangle' : 'sawtooth';
    o.frequency.value = f;
    o.detune.value = (i - 1.5) * 7;
    const g = c.createGain();
    g.gain.value = 0.09;
    o.connect(g).connect(filter);
    o.start();
    return o;
  });
  const scale = [440, 523.25, 587.33, 659.25, 783.99, 880];
  let step = 0;
  const timer = window.setInterval(() => {
    if (step % 2 === 0 || Math.random() < 0.35) tone({ type: 'sine', f0: scale[(step * 3 + Math.floor(step / 4)) % scale.length], dur: 0.9, vol: 0.05, lowpass: 2400, out });
    step++;
  }, 460);
  music = {
    stop() {
      window.clearInterval(timer);
      const t = c.currentTime;
      out.gain.setTargetAtTime(0, t, 0.4);
      window.setTimeout(() => { pads.forEach((o) => o.stop()); lfo.stop(); filter.disconnect(); out.gain.value = 0.18; }, 1600);
    },
  };
}

export function stopMusic() { music?.stop(); music = null; }
