import type { ArenaState } from '../game/host';
import type { Hit, Match, PosSample, RoomMeta, RoomStatus, Shot } from '../types';

export type SessionKind = 'online' | 'practice' | 'demo';

export interface FeedItem { id: number; t: number; text: string; slot: number }

/** What the arena scene and the HUD need from a room, whether it lives in Firebase or in this tab. */
export interface GameSession {
  readonly kind: SessionKind;
  readonly uid: string;
  readonly code: string;
  meta: RoomMeta | null;
  missing: boolean;
  state: ArenaState;
  version: number;
  readonly positions: Map<string, PosSample[]>;
  localPos?: PosSample;
  onShot?: (id: string, shot: Shot) => void;
  onHit?: (id: string, hit: Hit) => void;
  readonly feed: FeedItem[];
  readonly flags: Set<string>;
  readonly isHost: boolean;
  readonly status: RoomStatus | undefined;
  readonly match: Match | undefined;
  pushFeed(text: string, slot: number): void;
  flag(name: string): void;
  slotOf(uid: string): number;
  subscribe(fn: () => void): () => void;
  publishPos(sample: PosSample, force?: boolean): void;
  fire(shot: Omit<Shot, 'o'>): string;
  reportHit(hit: Omit<Hit, 'v'>): void;
  start(): Promise<void>;
  backToLobby(): Promise<void>;
  leave(): Promise<void>;
  dispose(): void;
}

/** Shared bookkeeping for the feed and tutorial flags. */
export class SessionExtras {
  readonly feed: FeedItem[] = [];
  readonly flags = new Set<string>();
  private feedId = 0;
  constructor(private readonly bump: () => void) {}
  pushFeed(text: string, slot: number) {
    this.feed.unshift({ id: this.feedId++, t: Date.now(), text, slot });
    if (this.feed.length > 5) this.feed.length = 5;
    this.bump();
  }
  flag(name: string) {
    if (this.flags.has(name)) return;
    this.flags.add(name);
    this.bump();
  }
}
