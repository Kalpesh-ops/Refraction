import type { ArenaState } from './game/host';

export type RoomStatus = 'lobby' | 'playing' | 'results';

/** `slot` is the cloak colour (unique per room); `figure` the silhouette. */
export interface Player { id: string; name: string; slot: number; figure?: number; joinedAt: number; connected: boolean }
/** A keeper's chosen look: cloak colour (slot) and silhouette (figure). */
export interface Look { slot: number; figure: number }
export interface RoomSettings { roundMs: number; winScore: number }
/** `seats` maps each keeper to a beacon, packed from 0 at the start of the round so beacons sit in fair pairs. */
export interface Match { round: number; startsAt: number; endsAt: number; seats?: Record<string, number>; winScore?: number }

/** Owner-written position sample. `s` is stunned-until (server ms). */
export interface PosSample { x: number; y: number; a: number; t: number; s: number }

/** A fired bolt. Every client traces the same path from it; the echo re-fires it echoDelayMs later. */
export interface Shot { o: string; x: number; y: number; a: number; t: number }

/** Reported by the victim. */
export interface Hit { v: string; by: string; sid: string; echo: boolean; x: number; y: number; t: number }

export interface RoomMeta {
  code: string;
  hostUid: string;
  status: RoomStatus;
  createdAt: number;
  players: Record<string, Player>;
  match?: Match;
  settings?: RoomSettings;
}

export type { ArenaState };
