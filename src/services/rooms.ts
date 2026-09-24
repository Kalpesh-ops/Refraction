import { get, onValue, ref, set, update } from 'firebase/database';
import { firebaseClient, firebaseEnabled, serverNow } from '../firebase';
import { PLAYER_COLORS, createSnapshot } from '../game/engine';
import type { InputIntent, Player, Room } from '../types';

const memory = new Map<string, Room>();
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return result;
}

function getPlayerColor(players: Record<string, Player> | undefined): string {
  const existingPlayers = Object.values(players ?? {});
  const usedColors = new Set(existingPlayers.map(p => p.color));
  const availableColor = PLAYER_COLORS.find(c => !usedColors.has(c));
  return availableColor ?? PLAYER_COLORS[existingPlayers.length % PLAYER_COLORS.length];
}

export async function identity() { const client = await firebaseClient(); return client?.uid ?? `local-${crypto.randomUUID().slice(0, 8)}`; }

export async function createRoom(name: string) {
  const uid = await identity();
  const client = await firebaseClient();
  let roomCode = generateCode();

  if (client) {
    for (let i = 0; i < 5; i++) {
      const snap = await get(ref(client.db, `rooms/${roomCode}`));
      if (!snap.exists()) break;
      roomCode = generateCode();
    }
    const player: Player = { id: uid, name, color: PLAYER_COLORS[0], joinedAt: Date.now(), connected: true };
    const room: Room = { code: roomCode, hostUid: uid, status: 'lobby', players: { [uid]: player }, createdAt: Date.now() };
    await set(ref(client.db, `rooms/${roomCode}`), room);
    return { roomCode, uid };
  } else {
    for (let i = 0; i < 5; i++) {
      if (!memory.has(roomCode)) break;
      roomCode = generateCode();
    }
    const player: Player = { id: uid, name, color: PLAYER_COLORS[0], joinedAt: Date.now(), connected: true };
    const room: Room = { code: roomCode, hostUid: uid, status: 'lobby', players: { [uid]: player }, createdAt: Date.now() };
    memory.set(roomCode, room);
    return { roomCode, uid };
  }
}

export async function joinRoom(roomCode: string, name: string) {
  const uid = await identity();
  const client = await firebaseClient();

  if (client) {
    const snap = await get(ref(client.db, `rooms/${roomCode}`));
    const room = snap.val() as Room | null;
    if (!snap.exists() || !room || !room.hostUid) {
      throw new Error('Room not found. Check the code.');
    }
    if (room.players && room.players[uid]) {
      await update(ref(client.db, `rooms/${roomCode}/players/${uid}`), {
        connected: true,
        name,
      });
      return { roomCode, uid };
    }
    if (room.status !== 'lobby') {
      throw new Error('That match already started. Wait for the next round.');
    }
    const existingPlayers = Object.values(room.players ?? {});
    if (existingPlayers.length >= 6) {
      throw new Error('That room is full.');
    }
    const color = getPlayerColor(room.players);
    const player: Player = { id: uid, name, color, joinedAt: Date.now(), connected: true };
    await update(ref(client.db, `rooms/${roomCode}/players/${uid}`), player);
    return { roomCode, uid };
  } else {
    const current = memory.get(roomCode);
    if (!current) {
      throw new Error('That room is not available in local preview. Create a new room first.');
    }
    if (current.players && current.players[uid]) {
      current.players[uid].connected = true;
      current.players[uid].name = name;
      return { roomCode, uid };
    }
    if (current.status !== 'lobby') {
      throw new Error('That match already started. Wait for the next round.');
    }
    const existingPlayers = Object.values(current.players ?? {});
    if (existingPlayers.length >= 6) {
      throw new Error('That room is full.');
    }
    const color = getPlayerColor(current.players);
    const player: Player = { id: uid, name, color, joinedAt: Date.now(), connected: true };
    current.players[uid] = player;
    memory.set(roomCode, current);
    return { roomCode, uid };
  }
}

export async function startRoom(room: Room) {
  if (Object.keys(room.players).length < 2) throw new Error('Refraction needs at least two players.');
  const snapshot = createSnapshot(room.players, serverNow());
  const client = await firebaseClient();
  if (client) {
    await update(ref(client.db, `rooms/${room.code}`), { status: 'playing', snapshot, inputs: null });
  } else {
    room.status = 'playing';
    room.snapshot = snapshot;
    delete room.inputs;
    memory.set(room.code, room);
  }
}

export async function resetRoom(roomCode: string) {
  const client = await firebaseClient();
  if (client) {
    await update(ref(client.db, `rooms/${roomCode}`), {
      status: 'lobby',
      snapshot: null,
      inputs: null,
    });
  } else {
    const room = memory.get(roomCode);
    if (room) {
      room.status = 'lobby';
      delete room.snapshot;
      delete room.inputs;
    }
  }
}
export async function sendInput(roomCode: string, uid: string, input: InputIntent) { const client = await firebaseClient(); if (client) await set(ref(client.db, `rooms/${roomCode}/inputs/${uid}`), input); else { const room = memory.get(roomCode); if (room) room.inputs = { ...room.inputs, [uid]: input }; } }

export async function writeSnapshot(roomCode: string, snapshot: Room['snapshot'], status?: Room['status']) {
  const client = await firebaseClient();
  if (client) {
    const sanitized = snapshot ? JSON.parse(JSON.stringify(snapshot)) : snapshot;
    await update(ref(client.db, `rooms/${roomCode}`), {
      snapshot: sanitized,
      ...(status ? { status } : {}),
    });
  } else {
    const room = memory.get(roomCode);
    if (room) {
      room.snapshot = snapshot;
      if (status) room.status = status;
    }
  }
}

export function watchRoom(roomCode: string, callback: (room: Room | null) => void) { if (!firebaseEnabled) { const timer = window.setInterval(() => callback(memory.get(roomCode) ?? null), 80); callback(memory.get(roomCode) ?? null); return () => clearInterval(timer); } let stop = () => {}; firebaseClient().then(client => { if (client) stop = onValue(ref(client.db, `rooms/${roomCode}`), snap => callback(snap.val())); }); return () => stop(); }
