import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { paintArena } from './art/floor';
import { KEEPERS, keeperOf } from './art/palette';
import { FIGURES, SHARD, beaconSprite, ghostSprite, keeperSprite } from './art/sprites';
import { isMuted, setMuted, sfx, startMusic, stopMusic, unlockAudio } from './audio/sfx';
import { serverNow } from './firebase';
import { H, OBSTACLES, ROUND_OPTIONS, SHRINES, TARGET_OPTIONS, TUNING, W } from './game/constants';
import { GameBoard } from './game/GameBoard';
import { standings } from './game/host';
import { LocalSession } from './net/local';
import { Session } from './net/session';
import type { GameSession } from './net/types';
import type { Look, RoomMeta, RoomSettings } from './types';
import { Footer, Privacy, Terms } from './ui/Legal';
import { Controls, Manual } from './ui/Manual';
import { Digits } from './ui/Digits';
import { Brand, PixelArt } from './ui/Pixel';
import './styles.css';

const NAME_KEY = 'refraction:name';
const LAST_ROOM_KEY = 'refraction:room';
const LOOK_KEY = 'refraction:look';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage may be blocked */ } },
};
const savedLook = (): Look => {
  try {
    const v = JSON.parse(store.get(LOOK_KEY) || '{}');
    return { slot: Number.isInteger(v.slot) && v.slot >= 0 && v.slot < KEEPERS.length ? v.slot : 0, figure: Number.isInteger(v.figure) && v.figure >= 0 && v.figure < FIGURES.length ? v.figure : 0 };
  } catch { return { slot: 0, figure: 0 }; }
};
const lookName = (look: Look) => `${keeperOf(look.slot).name} ${FIGURES[look.figure]?.name.toLowerCase() ?? 'keeper'}`;
const figureOf = (meta: RoomMeta, uid: string) => meta.players[uid]?.figure ?? 0;
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function useSession(session: GameSession | null) {
  const subscribe = useCallback((fn: () => void) => session?.subscribe(fn) ?? (() => {}), [session]);
  return useSyncExternalStore(subscribe, () => session?.version ?? 0);
}

function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => { const t = window.setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

function MuteButton() {
  const [muted, set] = useState(isMuted());
  return <button type="button" className="btn small quiet" onClick={() => { unlockAudio(); setMuted(!muted); set(!muted); }} aria-pressed={!muted}>{muted ? 'Sound off' : 'Sound on'}</button>;
}

export default function App() {
  if (location.pathname === '/terms') return <Terms />;
  if (location.pathname === '/privacy') return <Privacy />;
  return <Game />;
}

function Game() {
  const invite = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const [name, setName] = useState(store.get(NAME_KEY));
  const [code, setCode] = useState(invite);
  const [look, setLookState] = useState<Look>(savedLook);
  const setLook = (change: Partial<Look>) => setLookState((prev) => { const l = { ...prev, ...change }; store.set(LOOK_KEY, JSON.stringify(l)); return l; });
  const [session, setSession] = useState<GameSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'create' | 'join'>('');
  const autoTried = useRef(false);
  useSession(session);

  const validName = () => {
    const clean = name.trim();
    if (clean.length < 2) { setError('Pick a name with at least two letters.'); return null; }
    return clean;
  };

  const enter = useCallback(async (mode: 'create' | 'join', nameArg: string, codeArg: string) => {
    unlockAudio();
    setBusy(mode);
    setError('');
    try {
      const look = savedLook();
      const s = mode === 'create' ? await Session.create(nameArg, look) : await Session.join(codeArg.trim().toUpperCase(), nameArg, look);
      store.set(NAME_KEY, nameArg);
      store.set(LAST_ROOM_KEY, s.code);
      history.replaceState(null, '', `?room=${s.code}`);
      setCode(s.code);
      setSession(s);
      sfx.ui();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach that room.');
    } finally {
      setBusy('');
    }
  }, []);

  const practice = () => {
    const clean = name.trim().length >= 2 ? name.trim() : 'Keeper';
    unlockAudio();
    setError('');
    setSession(new LocalSession('practice', clean, look));
  };

  // A refresh drops you back into the room you were in.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    const saved = store.get(NAME_KEY);
    if (invite && store.get(LAST_ROOM_KEY) === invite && saved.length >= 2) void enter('join', saved, invite);
  }, [enter, invite]);

  useEffect(() => () => session?.dispose(), [session]);

  const leave = () => {
    void session?.leave();
    stopMusic();
    if (session?.kind === 'online') { store.set(LAST_ROOM_KEY, ''); history.replaceState(null, '', location.pathname); setCode(''); }
    setSession(null);
  };

  if (!session) {
    if (busy === 'join' && invite && !error) return <LobbySkeleton />;
    return (
      <Landing
        name={name} setName={setName} code={code} setCode={setCode} invite={invite} busy={busy} error={error} look={look} setLook={setLook}
        onCreate={() => { const n = validName(); if (n) void enter('create', n, ''); }}
        onJoin={() => { const n = validName(); if (n) void enter('join', n, code); }}
        onPractice={practice}
        clearInvite={() => { history.replaceState(null, '', location.pathname); setCode(''); setError(''); }}
      />
    );
  }
  if (session.missing) return <Notice title="This room has closed." body="The host may have left, or the link is old." action="Back to the front page" onAction={leave} />;
  if (!session.meta) return <LobbySkeleton />;
  if (session.status === 'playing') return <Playing session={session} leave={leave} goOnline={() => { leave(); }} />;
  if (session.status === 'results') return <Results session={session} leave={leave} />;
  return <Lobby session={session} leave={leave} />;
}

// ---------------- front page ----------------

interface LandingProps {
  name: string; setName: (v: string) => void; code: string; setCode: (v: string) => void; invite: string;
  busy: '' | 'create' | 'join'; error: string; onCreate: () => void; onJoin: () => void; onPractice: () => void; clearInvite: () => void;
  look: Look; setLook: (change: Partial<Look>) => void;
}

function Landing({ name, setName, code, setCode, invite, busy, error, onCreate, onJoin, onPractice, clearInvite, look, setLook }: LandingProps) {
  const joining = code.length > 0;
  return (
    <div className="paper">
      <header className="masthead">
        <Brand />
        <nav><a href="#manual">How to play</a><button type="button" className="linkish" onClick={onPractice}>Practice</button><a href="/terms">Terms</a><a href="/privacy">Privacy</a></nav>
      </header>
      <main className="front">
        <section className="intro">
          <p className="kicker">The Lens Works · Floor one · 2 to 6 keepers</p>
          <h1 className="wordmark">Refraction</h1>
          <p className="standfirst">A lantern duel in a derelict lighthouse foundry. Throw beams of lamplight off brass mirrors, carry amber lenses back to your beacon, and watch your step: three seconds after every beam, your echo throws it again.</p>
          <form className="ticket" onSubmit={(e) => { e.preventDefault(); if (joining) onJoin(); else onCreate(); }}>
            <h2>{invite ? `You are invited to room ${invite}` : 'Enter the Lens Works'}</h2>
            <label>
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="What should others call you?" maxLength={14} autoComplete="nickname" />
            </label>
            {!invite && (
              <label>
                <span>Room code <em>if a friend sent you one</em></span>
                <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="Five letters" maxLength={5} autoCapitalize="characters" inputMode="text" />
              </label>
            )}
            <div className="actions">
              <button type="submit" className="btn primary" disabled={Boolean(busy)}>{busy ? 'Opening the doors' : joining ? `Join room ${code}` : 'Light a new room'}</button>
              {joining && !invite && <button type="button" className="btn" disabled={Boolean(busy)} onClick={onCreate}>New room instead</button>}
              <button type="button" className="btn quiet" onClick={onPractice}>Practice alone</button>
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            {invite && error.startsWith('Room not found') && <button type="button" className="btn quiet" onClick={clearInvite}>Light a new room instead</button>}
            <p className="fineprint">No sign-up. Practice runs on your device and teaches you the game in about a minute.</p>
          </form>
        </section>
        <div className="front-side">
          <figure className="plate">
            <DemoArena />
            <figcaption><b>Plate I.</b> Three practice keepers playing live in your browser. The pale figure trailing each keeper is their echo: walk into someone else's and you are caught.</figcaption>
          </figure>
          <KeeperPicker look={look} name={name.trim() || 'You'} onChoose={setLook} />
        </div>
      </main>
      <section id="manual" className="section manual-section">
        <div className="manual-main">
          <h2 className="section-title">Field manual</h2>
          <Manual />
          <h2 className="section-title">Controls</h2>
          <Controls />
        </div>
        <FloorPlan />
      </section>
      <Footer />
    </div>
  );
}

function DemoArena() {
  const [demo, setDemo] = useState<LocalSession | null>(null);
  useEffect(() => {
    const d = new LocalSession('demo');
    setDemo(d);
    return () => d.dispose();
  }, []);
  return <div className="plate-frame">{demo ? <GameBoard session={demo} label="A live demonstration match" /> : <div className="skeleton fill" />}</div>;
}

/** Choose a figure and a lantern colour. Colours worn by others in the room are unavailable. */
function KeeperPicker({ look, name, onChoose, taken = {} }: { look: Look; name: string; onChoose: (change: Partial<Look>) => void; taken?: Record<number, string> }) {
  const choose = (change: Partial<Look>) => { sfx.ui(); onChoose(change); };
  return (
    <section className="panel picker" aria-labelledby="picker-title">
      <div className="picker-head">
        <PixelArt sprite={keeperSprite(look.slot, 0, look.figure)} scale={6} label={`${name}, ${lookName(look)}`} />
        <div>
          <p className="kicker">Your keeper</p>
          <h2 id="picker-title">{name}</h2>
          <p className="fineprint">The {lookName(look)}. Your beams, beacon and echo take this colour.</p>
        </div>
      </div>
      <fieldset className="picker-set">
        <legend>Figure</legend>
        <div className="picker-row">
          {FIGURES.map((f, i) => (
            <button key={f.name} type="button" className="pick" aria-pressed={i === look.figure} onClick={() => choose({ figure: i })}>
              <PixelArt sprite={keeperSprite(look.slot, 0, i)} scale={3} />
              <span>{f.name}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="picker-set">
        <legend>Lantern colour</legend>
        <div className="picker-row colours">
          {KEEPERS.map((k, i) => (
            <button key={k.name} type="button" className="pick" aria-pressed={i === look.slot} disabled={i in taken} title={i in taken ? `${taken[i]} has ${k.name}` : k.name} onClick={() => choose({ slot: i })}>
              <i style={{ background: k.cloak }} />
              <span>{i in taken ? taken[i] : k.name}</span>
            </button>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

/** Plate II: the floor of the hall, with the four things on it that matter. */
function FloorPlan() {
  const [src, setSrc] = useState('');
  useEffect(() => { setSrc(paintArena().toDataURL()); }, []);
  // Label a mirror and a stone wall away from the beacon in the top-left corner.
  const nearest = (kind: 'mirror' | 'stone', x: number, y: number) => OBSTACLES.filter((o) => o.kind === kind)
    .sort((a, b) => Math.hypot((a.ax + a.bx) / 2 - x, (a.ay + a.by) / 2 - y) - Math.hypot((b.ax + b.bx) / 2 - x, (b.ay + b.by) / 2 - y))[0];
  const mirror = nearest('mirror', W * 0.72, H * 0.3);
  const stone = nearest('stone', W * 0.3, H * 0.72);
  const marks = [
    { n: 1, x: SHRINES[0][0], y: SHRINES[0][1], title: 'Beacons', body: 'One per keeper, around the edge. Stand on yours to bank the lenses you carry.' },
    { n: 2, x: W / 2, y: H / 2, title: 'The prism', body: 'Casts a new lens into the hall every few seconds. Lenses land somewhere different each time.' },
    { n: 3, x: (mirror.ax + mirror.bx) / 2, y: (mirror.ay + mirror.by) / 2, title: 'Brass mirrors', body: 'Beams bounce off them, up to five times. Use them to catch someone around a corner.' },
    { n: 4, x: (stone.ax + stone.bx) / 2, y: (stone.ay + stone.by) / 2, title: 'Stone walls', body: 'Beams stop dead. Hide behind them when you carry lenses home.' },
  ];
  return (
    <figure className="plate floorplan">
      <div className="floor-frame">
        {src ? <img src={src} alt="The floor of the hall seen from above" /> : <div className="skeleton fill" />}
        {marks.map((m) => <span key={m.n} className="floor-mark" style={{ left: `${(m.x / W) * 100}%`, top: `${(m.y / H) * 100}%` }}><Digits value={m.n} size={2} /></span>)}
      </div>
      <figcaption><b>Plate II.</b> The floor of the hall.</figcaption>
      <ol className="floor-key">
        {marks.map((m) => <li key={m.n}><span className="floor-mark static"><Digits value={m.n} size={2} /></span><div><h3>{m.title}</h3><p>{m.body}</p></div></li>)}
      </ol>
      <div className="floor-cast" aria-label="Things in the hall">
        <span><PixelArt sprite={beaconSprite(0, true)} scale={2} />Beacon</span>
        <span><PixelArt sprite={SHARD} scale={3} />Lens</span>
        <span><PixelArt sprite={keeperSprite(2, 0, 2)} scale={2} />Keeper</span>
        <span><PixelArt sprite={ghostSprite(2, 2)} scale={2} />Echo</span>
      </div>
    </figure>
  );
}

function Notice({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  return (
    <div className="paper">
      <header className="masthead"><Brand /></header>
      <main className="notice"><h1>{title}</h1><p>{body}</p><button className="btn primary" onClick={onAction}>{action}</button></main>
    </div>
  );
}

function LobbySkeleton() {
  return (
    <div className="paper" aria-busy="true" aria-label="Opening the room">
      <header className="masthead"><Brand /></header>
      <main className="lobby">
        <div className="lobby-side">
          <section className="panel"><div className="skeleton line short" /><div className="skeleton block tall" /></section>
          <section className="panel"><div className="skeleton line" /><div className="skeleton row" /><div className="skeleton row" /><div className="skeleton row" /></section>
        </div>
        <section className="panel"><div className="skeleton line" />{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton row tall" />)}</section>
      </main>
    </div>
  );
}

// ---------------- lobby ----------------

function Lobby({ session, leave }: { session: GameSession; leave: () => void }) {
  const meta = session.meta!;
  const players = Object.values(meta.players).sort((a, b) => a.slot - b.slot);
  const present = players.filter((p) => p.connected).length;
  const me = meta.players[session.uid];
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const link = `${location.origin}/?room=${meta.code}`;
  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Refraction', text: `Join my Refraction room, code ${meta.code}`, url: link });
      else await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { window.prompt('Copy this invite link:', link); }
  };
  return (
    <div className="paper">
      <header className="masthead"><Brand /><nav><MuteButton /><button type="button" className="btn small quiet" onClick={leave}>Leave room</button></nav></header>
      <main className="lobby">
        <div className="lobby-side">
          <section className="panel ticket-stub">
            <p className="kicker">Room code</p>
            <p className="room-code" aria-label={`Room code ${meta.code.split('').join(' ')}`}>{meta.code}</p>
            <button type="button" className="btn primary wide" onClick={copy}>{copied ? 'Link copied' : 'Copy invite link'}</button>
            <p className="fineprint">Send the link to friends. They can join from a phone or a computer, up to six keepers.</p>
          </section>
          <section className="panel">
            <h2>Keepers here <span className="count"><Digits value={`${players.length}/6`} size={2} label={`${players.length} of 6`} /></span></h2>
            <ul className="roster">
              {players.map((p) => (
                <li key={p.id} className={p.connected ? '' : 'away'}>
                  <PixelArt sprite={keeperSprite(p.slot, 0, p.figure ?? 0)} scale={3} />
                  <span className="who"><b>{p.name}</b>{p.id === session.uid && ' (you)'}<small>{lookName({ slot: p.slot, figure: p.figure ?? 0 })}</small></span>
                  {p.id === meta.hostUid && <span className="tag">Host</span>}
                  {!p.connected && <span className="tag muted">Away</span>}
                </li>
              ))}
              {Array.from({ length: Math.max(0, 2 - players.length) }, (_, i) => <li key={`empty-${i}`} className="empty"><span className="who">Waiting for a keeper</span></li>)}
            </ul>
            {session.isHost
              ? <button type="button" className="btn primary wide" disabled={present < 2} onClick={() => { unlockAudio(); session.start().catch((e: Error) => setError(e.message)); }}>{present < 2 ? 'Needs one more keeper' : 'Light the lamps'}</button>
              : <p className="fineprint">The host starts the round when everyone is here.</p>}
            {error && <p className="error" role="alert">{error}</p>}
          </section>
        </div>
        <div className="lobby-mid">
          {me && (
            <KeeperPicker
              look={{ slot: me.slot, figure: me.figure ?? 0 }}
              name={me.name}
              taken={Object.fromEntries(players.filter((p) => p.id !== session.uid).map((p) => [p.slot, p.name]))}
              onChoose={(change) => { const l = { slot: me.slot, figure: me.figure ?? 0, ...change }; store.set(LOOK_KEY, JSON.stringify(l)); void session.setLook?.(l); }}
            />
          )}
          <RoundRules session={session} />
        </div>
        <section className="panel lobby-manual">
          <h2>Before the lamps are lit</h2>
          <Manual compact />
          <Controls />
        </section>
      </main>
    </div>
  );
}

function RoundRules({ session }: { session: GameSession }) {
  const settings = session.meta?.settings;
  const current: RoomSettings = {
    roundMs: settings?.roundMs ?? TUNING.roundMs,
    winScore: settings?.winScore ?? TUNING.winScore,
  };
  return (
    <section className="panel rules">
      <h2>Round rules</h2>
      {session.isHost ? (
        <>
          <label>
            <span>Round length</span>
            <select
              value={current.roundMs}
              onChange={(e) => session.setSettings?.({ ...current, roundMs: Number(e.target.value) })}
            >
              {ROUND_OPTIONS.map((ms) => (
                <option key={ms} value={ms}>
                  {Math.round(ms / 60_000)} minutes
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Lenses to win</span>
            <select
              value={current.winScore}
              onChange={(e) => session.setSettings?.({ ...current, winScore: Number(e.target.value) })}
            >
              {TARGET_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <p>{Math.round(current.roundMs / 60_000)} minutes, first to {current.winScore} lenses</p>
          <p className="fineprint">The host sets the rules.</p>
        </>
      )}
    </section>
  );
}

// ---------------- in the arena ----------------

const COACH = [
  { flag: 'moved', text: 'Walk around. WASD or the arrow keys.', touch: 'Walk around. Press and drag on the left half of the screen.' },
  { flag: 'fired', text: 'Throw a beam. Aim with the mouse and click.', touch: 'Throw a beam. Drag on the right half and let go.' },
  { flag: 'bounced', text: 'Hit a brass mirror. Beams bounce off glass and stop on stone.', touch: 'Hit a brass mirror. Beams bounce off glass and stop on stone.' },
  { flag: 'echo', text: 'Fire once more and wait. Three seconds later, your echo throws the same beam. Keep clear of other echoes: touching one catches you.', touch: 'Fire once more and wait. Three seconds later, your echo throws the same beam. Keep clear of other echoes: touching one catches you.' },
  { flag: 'picked', text: 'Walk over an amber lens to pick it up.', touch: 'Walk over an amber lens to pick it up.' },
  { flag: 'banked', text: 'Carry it to your beacon, the lamp in your colour. The dots by your feet point the way.', touch: 'Carry it to your beacon, the lamp in your colour. The dots by your feet point the way.' },
  { flag: 'stunned', text: 'Now the others fight back. Catch one with a beam: they drop what they carry, and you steal a lens from their beacon.', touch: 'Now the others fight back. Catch one with a beam: they drop what they carry, and you steal a lens from their beacon.' },
];

function Coach({ session, onDone }: { session: GameSession; onDone: () => void }) {
  const touch = matchMedia('(pointer: coarse)').matches;
  const index = COACH.findIndex((c) => !session.flags.has(c.flag));
  const done = index === -1;
  return (
    <aside className="coach" aria-live="polite">
      <div className="coach-pips">{COACH.map((c, i) => <i key={c.flag} className={session.flags.has(c.flag) ? 'on' : i === index ? 'now' : ''} />)}</div>
      {done ? (
        <>
          <p><b>That is the whole game.</b> Light a room and send the link to a friend.</p>
          <div className="actions"><button className="btn primary small" onClick={onDone}>Light a room</button></div>
        </>
      ) : (
        <p><span className="coach-step">Field note {index + 1} of {COACH.length}</span>{touch ? COACH[index].touch : COACH[index].text}</p>
      )}
    </aside>
  );
}

function Playing({ session, leave, goOnline }: { session: GameSession; leave: () => void; goOnline: () => void }) {
  useTicker(200);
  const meta = session.meta!;
  const match = session.match;
  const goal = match?.winScore ?? TUNING.winScore;
  const now = serverNow();
  const state = session.state;
  const practice = session.kind === 'practice';
  const participants = Object.keys(state.score).sort((a, b) => (state.score[b] ?? 0) - (state.score[a] ?? 0) || session.slotOf(a) - session.slotOf(b));
  const countdown = match ? Math.ceil((match.startsAt - now) / 1000) : 0;
  const started = match ? now >= match.startsAt : false;
  const remaining = match ? (started ? match.endsAt - now : match.endsAt - match.startsAt) : 0;
  const spectating = !(session.uid in state.score);
  const feed = session.feed.filter((f) => Date.now() - f.t < 6000).slice(0, 4);

  useEffect(() => { if (started) startMusic(); }, [started]);
  useEffect(() => () => stopMusic(), []);

  return (
    <main className="play">
      <header className="hud">
        <div className="hud-left">
          <span className="hud-goal"><span className="hud-label">First to</span><Digits value={goal} size={3} /></span>
          {!practice && <strong className={`hud-clock ${started && remaining < 15_000 ? 'late' : ''}`}><Digits value={clock(remaining)} size={3} label={`${clock(remaining)} left`} /></strong>}
        </div>
        <ol className="hud-board" aria-label="Lenses banked">
          {participants.map((uid) => {
            const p = meta.players[uid];
            const carry = state.carry[uid] ?? 0;
            return (
              <li key={uid} className={uid === session.uid ? 'me' : ''}>
                <PixelArt sprite={keeperSprite(p?.slot ?? 0, 0, figureOf(meta, uid))} scale={1.5} />
                <span className="name">{uid === session.uid ? 'You' : p?.name}</span>
                <b><Digits value={state.score[uid] ?? 0} size={3} /></b>
                {carry > 0 && <span className="carry" title={`Carrying ${carry}`}><Digits value={`+${carry}`} size={2} /></span>}
              </li>
            );
          })}
        </ol>
        <div className="hud-tools"><MuteButton />{practice && <button type="button" className="btn small quiet" onClick={leave}>Leave</button>}</div>
      </header>
      <div className="stage">
        <GameBoard session={session} />
        {!started && countdown > 0 && (
          <div className="countdown" key={countdown}>
            <div className="countdown-plate"><Digits value={countdown} size={22} /><span>First to {goal} lenses lights the lighthouse</span></div>
          </div>
        )}
        {started && match && now - match.startsAt < 800 && <div className="countdown go"><div className="countdown-plate"><span className="go-word">Go</span></div></div>}
        {spectating && !practice && <p className="banner">You joined mid-round. You will play in the next one.</p>}
        <p className="rotate-hint">Turn your phone sideways for a bigger arena.</p>
      </div>
      <footer className="hud-foot">
        {practice ? <Coach session={session} onDone={goOnline} /> : <span className="hud-help">Bank lenses at your beacon. Your echo repeats every beam 3 s later, and catches anyone who walks into it.</span>}
        <ul className="feed" aria-live="polite">
          {feed.map((f) => <li key={f.id}><i style={{ background: keeperOf(f.slot).cloak }} />{f.text}</li>)}
        </ul>
      </footer>
    </main>
  );
}

// ---------------- results ----------------

function Results({ session, leave }: { session: GameSession; leave: () => void }) {
  const meta = session.meta!;
  const match = session.match;
  const goal = match?.winScore ?? TUNING.winScore;
  const state = session.state;
  const { ranked, tie } = standings(state, Object.keys(state.score));
  const winner = meta.players[ranked[0]];
  const played = useRef(false);
  useEffect(() => { if (!played.current) { played.current = true; stopMusic(); sfx.end(); } }, []);
  const who = ranked[0] === session.uid ? 'You' : winner?.name ?? 'A keeper';
  const title = state.winner ? `${who} lit the lighthouse` : tie ? 'Time. The flame is shared' : `Time. ${who} kept the flame`;
  const again = session.kind === 'practice' ? 'Play again' : 'Back to the lobby';
  return (
    <div className="paper">
      <header className="masthead"><Brand /><nav><button type="button" className="btn small quiet" onClick={leave}>Leave room</button></nav></header>
      <main className="results">
        <div className="results-main">
        <p className="kicker">{state.winner ? `First to ${goal} lenses` : "The clock ran out"} · the ledger</p>
        <div className="results-head">
          <h1>{title}</h1>
          {!tie && winner && <PixelArt sprite={keeperSprite(winner.slot, 0, winner.figure ?? 0)} scale={8} label={`${winner.name}, the winner`} />}
        </div>
        <table className="ledger">
          <thead><tr><th scope="col">Place</th><th scope="col">Keeper</th><th scope="col">Lenses banked</th><th scope="col">Catches</th></tr></thead>
          <tbody>
            {ranked.map((uid) => {
              const p = meta.players[uid];
              const place = 1 + ranked.filter((o) => (state.score[o] ?? 0) > (state.score[uid] ?? 0)).length;
              return (
                <tr key={uid} className={place === 1 && !tie ? 'first' : ''}>
                  <td><Digits value={place} size={3} /></td>
                  <td className="who"><PixelArt sprite={keeperSprite(p?.slot ?? 0, 0, p?.figure ?? 0)} scale={2} /><span>{p?.name}{uid === session.uid && ' (you)'}</span></td>
                  <td><Digits value={state.score[uid] ?? 0} size={3} /></td>
                  <td><Digits value={state.stuns[uid] ?? 0} size={3} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="actions">
          {session.isHost ? <button className="btn primary" onClick={() => session.backToLobby()}>{again}</button> : <p className="fineprint">The host can start another round.</p>}
          <button className="btn quiet" onClick={leave}>Leave room</button>
        </div>
        </div>
        <RoundNotes session={session} ranked={ranked} />
      </main>
    </div>
  );
}


/** The margin of the ledger: a few facts about the round just played. */
function RoundNotes({ session, ranked }: { session: GameSession; ranked: string[] }) {
  const meta = session.meta!;
  const state = session.state;
  const name = (uid: string) => (uid === session.uid ? 'You' : meta.players[uid]?.name ?? 'A keeper');
  const banked = ranked.reduce((n, uid) => n + (state.score[uid] ?? 0), 0);
  const catches = ranked.reduce((n, uid) => n + (state.stuns[uid] ?? 0), 0);
  const hunter = [...ranked].sort((a, b) => (state.stuns[b] ?? 0) - (state.stuns[a] ?? 0))[0];
  const hunted = hunter && (state.stuns[hunter] ?? 0) > 0;
  return (
    <aside className="panel notes">
      <p className="kicker">Round <Digits value={meta.match?.round ?? 1} size={2} /> · notes</p>
      <div className="notes-cast">
        {ranked.map((uid) => {
          const p = meta.players[uid];
          return <PixelArt key={uid} sprite={keeperSprite(p?.slot ?? 0, 0, p?.figure ?? 0)} scale={4} label={p?.name} />;
        })}
      </div>
      <dl>
        <div><dt>Lenses banked</dt><dd><Digits value={banked} size={3} /></dd></div>
        <div><dt>Catches</dt><dd><Digits value={catches} size={3} /></dd></div>
        <div><dt>Keepers</dt><dd><Digits value={ranked.length} size={3} /></dd></div>
      </dl>
      <p>{hunted ? `${name(hunter)} made the most catches (${state.stuns[hunter]}).` : 'Nobody was caught this round. Next time, throw more light.'}</p>
      <p className="fineprint">Catches drop the lenses a keeper carries and steal one from their beacon. Echoes catch on touch.</p>
    </aside>
  );
}
