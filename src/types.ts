import type { ArenaState } from './game/host';

export type RoomStatus = 'lobby' | 'playing' | 'results';

export interface Player { id: string; name: string; slot: number; joinedAt: number; connected: boolean }
export interface Match { round: number; startsAt: number; endsAt: number }

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
}

export type { ArenaState };
