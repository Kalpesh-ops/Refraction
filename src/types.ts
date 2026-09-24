export type RoomStatus = 'lobby' | 'playing' | 'results';

export interface InputIntent { x: number; y: number; dash: boolean; updatedAt: number }
export interface Player { id: string; name: string; color: string; joinedAt: number; connected: boolean }
export interface ReflectionPoint { x: number; y: number; at: number }
export interface Runner { id: string; slot: number; x: number; y: number; score: number; carrying: boolean; dashReadyAt: number; trail: ReflectionPoint[] }
export interface Relic { id: string; x: number; y: number; active: boolean; carrierId?: string }
export interface MatchSnapshot { startedAt: number; endsAt: number; runners: Record<string, Runner>; relics: Record<string, Relic>; winnerId?: string }
export interface Room { code: string; hostUid: string; status: RoomStatus; players: Record<string, Player>; inputs?: Record<string, InputIntent>; snapshot?: MatchSnapshot; createdAt: number }
export interface MatchResult { winnerId: string; scores: Array<{ id: string; name: string; score: number }> }
