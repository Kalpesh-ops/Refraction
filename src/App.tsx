import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isMuted, setMuted, sfx, startMusic, stopMusic, unlockAudio } from './audio/sfx';
import { serverNow } from './firebase';
import { PLAYER_COLORS, TUNING } from './game/constants';
import { GameBoard } from './game/GameBoard';
import { standings } from './game/host';
import { Session } from './net/session';
import './styles.css';

const NAME_KEY = 'refraction:name';
const LAST_ROOM_KEY = 'refraction:room';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const colorFor = (slot: number) => PLAYER_COLORS[slot % PLAYER_COLORS.length];
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function useSession(session: Session | null) {
  const subscribe = useCallback((fn: () => void) => session?.subscribe(fn) ?? (() => {}), [session]);
  return useSyncExternalStore(subscribe, () => session?.version ?? 0);
}

function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => { const t = window.setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}

export default function App() {
  const invite = (new URLSearchParams(location.search).get('room') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const [name, setName] = useState(store.get(NAME_KEY));
  const [code, setCode] = useState(invite);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [muted, setMutedState] = useState(isMuted());
  const autoTried = useRef(false);
  useSession(session);

  const enter = useCallback(async (mode: 'create' | 'join', nameArg = name, codeArg = code) => {
    const clean = nameArg.trim();
    if (clean.length < 2) { setError('Choose a name with at least two characters.'); return; }
    unlockAudio();
    setBusy(true);
    setError('');
    try {
      const s = mode === 'create' ? await Session.create(clean) : await Session.join(codeArg.trim().toUpperCase(), clean);
      store.set(NAME_KEY, clean);
      store.set(LAST_ROOM_KEY, s.code);
      history.replaceState(null, '', `?room=${s.code}`);
      setCode(s.code);
      setSession(s);
      sfx.ui();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to enter that room.');
    } finally {
      setBusy(false);
    }
  }, [name, code]);

  // Refreshing the page drops you straight back into the room you were in.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    if (invite && store.get(LAST_ROOM_KEY) === invite && store.get(NAME_KEY).length >= 2) void enter('join', store.get(NAME_KEY), invite);
  }, [enter, invite]);

  useEffect(() => () => session?.dispose(), [session]);

  const leave = () => {
    void session?.leave();
    setSession(null);
    stopMusic();
    store.set(LAST_ROOM_KEY, '');
    history.replaceState(null, '', location.pathname);
    setCode('');
  };

  const toggleMute = () => { unlockAudio(); setMuted(!muted); setMutedState(!muted); };
  const muteButton = <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? 'Sound off' : 'Sound on'}</button>;

  if (!session) return <Landing name={name} setName={setName} code={code} setCode={setCode} invite={invite} busy={busy} error={error} enter={enter} clearInvite={() => { history.replaceState(null, '', location.pathname); setCode(''); setError(''); }} />;
  if (session.missing) return <main className="screen center"><h2>This room no longer exists.</h2><button onClick={leave}>Back to start</button></main>;
  if (!session.meta) return <main className="screen center"><p className="muted">Opening the mirror maze…</p></main>;
  if (session.status === 'playing') return <Playing session={session} muteButton={muteButton} />;
  if (session.status === 'results') return <Results session={session} leave={leave} />;
  return <Lobby session={session} leave={leave} muteButton={muteButton} />;
}

function Landing(props: { name: string; setName: (v: string) => void; code: string; setCode: (v: string) => void; invite: string; busy: boolean; error: string; enter: (m: 'create' | 'join') => void; clearInvite: () => void }) {
  const { name, setName, code, setCode, invite, busy, error, enter, clearInvite } = props;
  const submit = (e: React.FormEvent) => { e.preventDefault(); enter(code ? 'join' : 'create'); };
  return (
    <main className="landing">
      <section className="hero">
        <p className="eyebrow">Live multiplayer · 2–6 players</p>
        <h1>Refraction</h1>
        <p className="lede">Fire light through a hall of mirrors. Three seconds later, your echo fires the same shot again.</p>
        <ul className="pills"><li>2-minute rounds</li><li>Phone + desktop</li><li>No sign-up</li></ul>
      </section>
      <form className="card entry" onSubmit={submit}>
        <h2>{invite ? `Join room ${invite}` : 'Enter the maze'}</h2>
        <label>Display name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={14} autoComplete="nickname" /></label>
        {!invite && <label>Room code <span className="muted">(leave empty to create)</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="ABCDE" maxLength={5} autoCapitalize="characters" /></label>}
        <div className="row">
          <button type="submit" disabled={busy}>{busy ? 'Connecting…' : code ? 'Join room' : 'Create a room'}</button>
          {!invite && code && <button type="button" className="ghost" disabled={busy} onClick={() => enter('create')}>New room</button>}
        </div>
        {error && <p className="error">{error}</p>}
        {invite && error.startsWith('Room not found') && <button type="button" className="ghost" onClick={clearInvite}>Create a new room instead</button>}
      </form>
    </main>
  );
}

const HOW_TO = [
  { title: 'Move', body: 'WASD or arrows. On phones, drag the left side of the screen.' },
  { title: 'Fire light', body: 'Aim with the mouse, click or Space to fire. On phones, drag the right side and release. Bolts bounce off glowing mirrors; stone absorbs them.' },
  { title: 'Your echo', body: 'Every shot you fire is fired again 3 seconds later from the same spot. Set traps with your past self, and dodge rivals’ echoes too.' },
  { title: 'Bank shards', body: 'Grab prism shards (up to 5) and bring them to your own shrine to score. Get hit and you drop everything you carry.' },
];

function Lobby({ session, leave, muteButton }: { session: Session; leave: () => void; muteButton: React.ReactNode }) {
  const meta = session.meta!;
  const players = Object.values(meta.players).sort((a, b) => a.slot - b.slot);
  const connected = players.filter((p) => p.connected).length;
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const link = `${location.origin}${location.pathname}?room=${meta.code}`;
  const copy = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: 'Refraction', text: `Join my Refraction room ${meta.code}`, url: link });
      else await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { window.prompt('Copy this invite link:', link); }
  };
  return (
    <main className="screen lobby">
      <header className="topbar">
        <div><p className="eyebrow">Room code</p><h1 className="code">{meta.code}</h1></div>
        <div className="row">{muteButton}<button className="ghost" onClick={copy}>{copied ? 'Copied' : 'Invite link'}</button><button className="ghost" onClick={leave}>Leave</button></div>
      </header>
      <div className="lobby-grid">
        <section className="card">
          <h2>{players.length} / 6 runners</h2>
          <ul className="roster">
            {players.map((p) => (
              <li key={p.id} className={p.connected ? '' : 'offline'}>
                <i style={{ background: colorFor(p.slot), boxShadow: `0 0 14px ${colorFor(p.slot)}` }} />
                <span>{p.name}{p.id === session.uid && <em> (you)</em>}</span>
                {p.id === meta.hostUid && <small>Host</small>}
                {!p.connected && <small>Away</small>}
              </li>
            ))}
          </ul>
          {session.isHost
            ? <button className="big" disabled={connected < 2} onClick={() => { unlockAudio(); session.start().catch((e) => setError(e.message)); }}>{connected < 2 ? 'Waiting for a second player…' : 'Start the round'}</button>
            : <p className="muted">Waiting for the host to start.</p>}
          {error && <p className="error">{error}</p>}
          <p className="muted small">Share the invite link. Anyone with it can join from any device.</p>
        </section>
        <section className="card howto">
          <h2>How to play</h2>
          <ol>{HOW_TO.map((h, i) => <li key={h.title}><b>{i + 1}</b><div><strong>{h.title}</strong><p>{h.body}</p></div></li>)}</ol>
          <p className="muted small">Most shards banked after 2 minutes wins. Carrying shards slows you down, so bank often.</p>
        </section>
      </div>
    </main>
  );
}

function Playing({ session, muteButton }: { session: Session; muteButton: React.ReactNode }) {
  useTicker(200);
  const meta = session.meta!;
  const match = session.match;
  const now = serverNow();
  const state = session.state;
  const participants = Object.keys(state.score).sort((a, b) => (state.score[b] ?? 0) - (state.score[a] ?? 0));
  const countdown = match ? Math.ceil((match.startsAt - now) / 1000) : 0;
  const started = match ? now >= match.startsAt : false;
  const remaining = match ? (started ? match.endsAt - now : TUNING.roundMs) : 0;
  const spectating = !(session.uid in state.score);

  useEffect(() => { if (started) startMusic(); }, [started]);
  useEffect(() => () => stopMusic(), []);

  return (
    <main className="play">
      <GameBoard session={session} />
      <div className="hud">
        <div className="hud-left"><span className="code-chip">{meta.code}</span>{muteButton}</div>
        <div className={`timer ${remaining < 15_000 && started ? 'urgent' : ''}`}>{clock(remaining)}</div>
        <ol className="scores">
          {participants.map((uid) => {
            const p = meta.players[uid];
            return (
              <li key={uid} className={uid === session.uid ? 'me' : ''}>
                <i style={{ background: colorFor(p?.slot ?? 0) }} />
                <span className="name">{p?.name ?? '—'}</span>
                <b>{state.score[uid] ?? 0}</b>
                {(state.carry[uid] ?? 0) > 0 && <small>+{state.carry[uid]}</small>}
              </li>
            );
          })}
        </ol>
      </div>
      {!started && countdown > 0 && <div className="countdown" key={countdown}>{countdown}</div>}
      {started && now - match!.startsAt < 700 && <div className="countdown go">GO</div>}
      {spectating && <p className="spectating">Spectating: you'll join next round.</p>}
      <p className="rotate-hint">Turn your phone sideways for a bigger arena.</p>
    </main>
  );
}

function Results({ session, leave }: { session: Session; leave: () => void }) {
  const meta = session.meta!;
  const state = session.state;
  const uids = Object.keys(state.score);
  const { ranked, tie } = standings(state, uids);
  const winner = meta.players[ranked[0]];
  const played = useRef(false);
  useEffect(() => { if (!played.current) { played.current = true; stopMusic(); sfx.end(); } }, []);
  return (
    <main className="screen center results">
      <p className="eyebrow">Round over</p>
      <h1>{tie ? 'A perfect tie' : `${winner?.name ?? 'A runner'} wins`}</h1>
      <ol className="podium">
        {ranked.map((uid, i) => {
          const p = meta.players[uid];
          return (
            <li key={uid} style={{ ['--c' as string]: colorFor(p?.slot ?? 0) }}>
              <b>{i + 1}</b>
              <span>{p?.name ?? '—'}{uid === session.uid && <em> (you)</em>}</span>
              <small>{state.stuns[uid] ?? 0} stun{(state.stuns[uid] ?? 0) === 1 ? '' : 's'}</small>
              <strong>{state.score[uid] ?? 0}</strong>
            </li>
          );
        })}
      </ol>
      <div className="row">
        {session.isHost ? <button className="big" onClick={() => session.backToLobby()}>Play again</button> : <p className="muted">The host can start another round.</p>}
        <button className="ghost" onClick={leave}>Leave room</button>
      </div>
    </main>
  );
}
