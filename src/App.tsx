import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameBoard } from './game/GameBoard';
import { tick, winnerId } from './game/engine';
import { serverNow } from './firebase';
import { createRoom, joinRoom, sendInput, startRoom, watchRoom, writeSnapshot } from './services/rooms';
import type { InputIntent, Room } from './types';
import './styles.css';

const initialInput: InputIntent = { x: 0, y: 0, dash: false, updatedAt: 0 };
const formatTime = (end?: number) => Math.max(0, Math.ceil(((end ?? serverNow()) - serverNow()) / 1000)).toString().padStart(2, '0');

export default function App() {
  const params = new URLSearchParams(location.search); const inviteRoom = params.get('room')?.toUpperCase() ?? '';
  const [name, setName] = useState(''); const [roomCode, setRoomCode] = useState(inviteRoom); const [uid, setUid] = useState(''); const [room, setRoom] = useState<Room | null>(null); const [error, setError] = useState(''); const [now, setNow] = useState(serverNow()); const input = useRef<InputIntent>(initialInput);
  const roomRef = useRef<Room | null>(null);
  useEffect(() => { roomRef.current = room; }, [room]);

  const join = async (create = false) => { try { setError(''); if (name.trim().length < 2) throw new Error('Choose a name with at least two characters.'); const session = create ? await createRoom(name.trim()) : await joinRoom(roomCode.trim(), name.trim()); setUid(session.uid); setRoomCode(session.roomCode); history.replaceState(null, '', `?room=${session.roomCode}`); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to enter that room.'); } };
  useEffect(() => { if (!roomCode || !uid) return; return watchRoom(roomCode, setRoom); }, [roomCode, uid]);
  useEffect(() => { const t = window.setInterval(() => setNow(serverNow()), 500); return () => clearInterval(t); }, []);
  useEffect(() => {
    const pressed = new Set<string>();

    const updateMovement = () => {
      const right = pressed.has('ArrowRight') || pressed.has('KeyD');
      const left = pressed.has('ArrowLeft') || pressed.has('KeyA');
      const down = pressed.has('ArrowDown') || pressed.has('KeyS');
      const up = pressed.has('ArrowUp') || pressed.has('KeyW');
      const x = (right ? 1 : 0) - (left ? 1 : 0);
      const y = (down ? 1 : 0) - (up ? 1 : 0);
      input.current = { ...input.current, x, y, updatedAt: Date.now() };
    };

    const handleDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }

      if (event.code === 'Space') {
        input.current = { ...input.current, dash: true, updatedAt: Date.now() };
      }

      if (['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS', 'ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(event.code)) {
        pressed.add(event.code);
        updateMovement();
      }
    };

    const handleUp = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) {
        event.preventDefault();
      }

      if (event.code === 'Space') {
        input.current = { ...input.current, dash: false, updatedAt: Date.now() };
      }

      if (['ArrowUp', 'KeyW', 'ArrowDown', 'KeyS', 'ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(event.code)) {
        pressed.delete(event.code);
        updateMovement();
      }
    };

    const handleBlur = () => {
      pressed.clear();
      input.current = { ...input.current, x: 0, y: 0, dash: false, updatedAt: Date.now() };
    };

    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleDown);
      window.removeEventListener('keyup', handleUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);
  useEffect(() => {
    if (room?.status !== 'playing' || !room?.code || !uid) return;
    const code = room.code;
    let lastSent: InputIntent | null = null;
    let lastSentAt = 0;

    const interval = window.setInterval(() => {
      const current = input.current;
      const currentTime = Date.now();
      const changed = !lastSent ||
        current.x !== lastSent.x ||
        current.y !== lastSent.y ||
        current.dash !== lastSent.dash;
      const heartbeat = currentTime - lastSentAt >= 1000;

      if (changed || heartbeat) {
        lastSent = { ...current };
        lastSentAt = currentTime;
        sendInput(code, uid, current).catch(console.error);
      }
    }, 60);

    return () => clearInterval(interval);
  }, [room?.status, room?.code, uid]);
  useEffect(() => {
    if (room?.status !== 'playing' || room?.hostUid !== uid || !room?.code || !roomRef.current?.snapshot) return;
    const code = room.code;
    let state = roomRef.current!.snapshot!;
    let last = serverNow();
    let writing = false;

    const interval = window.setInterval(() => {
      const now = serverNow();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      state = tick(state, roomRef.current?.inputs ?? {}, now, dt);
      const done = now >= state.endsAt;
      if (!writing) {
        writing = true;
        writeSnapshot(code, state, done ? 'results' : undefined)
          .catch(console.error)
          .finally(() => {
            writing = false;
          });
      }
      if (done) clearInterval(interval);
    }, 50);

    return () => clearInterval(interval);
  }, [room?.status, room?.code, room?.hostUid, uid]);
  const move = useCallback((x: number, y: number) => { input.current = { ...input.current, x, y, updatedAt: Date.now() }; }, []);
  const dash = useCallback(() => { input.current = { ...input.current, dash: true, updatedAt: Date.now() }; setTimeout(() => input.current = { ...input.current, dash: false, updatedAt: Date.now() }, 120); }, []);
  const ordered = useMemo(() => room?.snapshot ? Object.values(room.snapshot.runners).sort((a,b) => b.score-a.score) : [], [room?.snapshot]);
  if (!uid) return <main className="welcome"><section className="brand"><p className="eyebrow">A live mirror maze</p><h1>Refraction</h1><p>Outrun your past. Let your echo open the way.</p><div className="rules"><span>2–6 players</span><span>3 minute rounds</span><span>Phones + desktop</span></div></section><section className="entry"><h2>{inviteRoom ? `Enter room ${inviteRoom}` : 'Gather your runners'}</h2><label>Display name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" maxLength={16} /></label>{!inviteRoom && <label>Room code<input value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())} placeholder="ABCDE" maxLength={5} /></label>}<div className="actions">{inviteRoom || roomCode ? <button onClick={()=>join(false)}>Join room</button> : <button onClick={()=>join(true)}>Create a room</button>} {!inviteRoom && roomCode && <button className="quiet" onClick={()=>join(true)}>New room</button>}</div>{error && <p className="error">{error}</p>}<p className="help">Your reflection repeats your path after five seconds. Reflections hold sigil plates, letting you take relics and return them to your shrine.</p></section></main>;
  if (!room) return <main className="welcome"><p className="loading">Finding the mirror maze...</p></main>;
  if (room.status === 'lobby') return <main className="lobby"><header><div><p className="eyebrow">Room code</p><h1>{room.code}</h1></div><button className="quiet" onClick={()=>navigator.clipboard.writeText(location.href)}>Copy invite link</button></header><section className="lobby-center"><p className="eyebrow">The maze is waiting</p><h2>{Object.keys(room.players).length} / 6 runners arrived</h2><div className="player-list">{Object.values(room.players).map(player=><div key={player.id}><i style={{background:player.color}} />{player.name}{player.id===room.hostUid && <small>Host</small>}</div>)}</div>{room.hostUid === uid ? <button disabled={Object.keys(room.players).length<2} onClick={()=>startRoom(room).catch(e=>setError(e.message))}>Begin Refraction</button> : <p className="waiting">Waiting for the host to begin.</p>}{error && <p className="error">{error}</p>}<aside><strong>How to win</strong><span>Time your echo onto a glowing plate. Take a relic while the plate is held, then bring it to your outlined shrine. Dash makes rivals drop relics.</span></aside></section></main>;
  if (room.status === 'results' && room.snapshot) { const victor = winnerId(room.snapshot); return <main className="results"><p className="eyebrow">The mirror settles</p><h1>{room.players[victor]?.name ?? 'A runner'} wins</h1><div className="result-list">{ordered.map((runner,index)=><div key={runner.id}><b>0{index+1}</b><span>{room.players[runner.id]?.name}</span><strong>{runner.score} relic{runner.score===1?'':'s'}</strong></div>)}</div>{room.hostUid===uid ? <button onClick={()=>startRoom({...room,status:'lobby'}).catch(e=>setError(e.message))}>Play again</button> : <p className="waiting">The host can start another round.</p>}</main>; }
  return <main className="game"><header className="hud"><div><p className="eyebrow">Room {room.code}</p><strong>Refraction</strong></div><div className="timer">{formatTime(room.snapshot?.endsAt)}<small>remaining</small></div><div className="scoreline">{ordered.slice(0,3).map(r=><span key={r.id}><i style={{background:room.players[r.id]?.color}} />{r.score}</span>)}</div></header><GameBoard snapshot={room.snapshot} players={room.players} uid={uid}/><section className="mobile-controls" onContextMenu={e => e.preventDefault()}><div className="dpad"><button onPointerDown={()=>move(0,-1)} onPointerUp={()=>move(0,0)} onPointerCancel={()=>move(0,0)} onPointerLeave={()=>move(0,0)}>▲</button><button onPointerDown={()=>move(-1,0)} onPointerUp={()=>move(0,0)} onPointerCancel={()=>move(0,0)} onPointerLeave={()=>move(0,0)}>◀</button><button onPointerDown={()=>move(1,0)} onPointerUp={()=>move(0,0)} onPointerCancel={()=>move(0,0)} onPointerLeave={()=>move(0,0)}>▶</button><button onPointerDown={()=>move(0,1)} onPointerUp={()=>move(0,0)} onPointerCancel={()=>move(0,0)} onPointerLeave={()=>move(0,0)}>▼</button></div><button className="dash" onPointerDown={dash}>Dash</button></section><p className="controls">Move: WASD / arrows · Dash: space · Your pale echo holds sigil plates five seconds behind you.</p></main>;
}
