/**
 * Wire protocol shared by server and client.
 *
 * ── Multiplayer architecture (authoritative server) ──────────────────────
 *
 *   browser A ──grab/drag/release──▶ ┌────────────┐ ──snapshots (20-30 Hz)──▶ all
 *   browser B ──grab/drag/release──▶ │   server   │ ──grabbed / released ───▶ all
 *   browser C ──cursor (near only)─▶ │ World sim  │ ──feed / hype / stats ──▶ all
 *                                    └────────────┘
 *
 * - The server owns the ONLY real copy of Claude (position, velocity,
 *   rotation, spin, who's holding him). It simulates at 60 Hz with 240 Hz
 *   substeps using lib/physics.ts.
 * - Clients never broadcast "Claude is here". They send *intent*:
 *     grab    – "I pressed on him at this point" (server arbitrates ownership,
 *               first request processed wins; it replies via ack)
 *     drag    – the holder's pointer target + velocity, ~30 Hz
 *     release – the holder's release velocity/spin, computed from the last
 *               ~70 ms of pointer samples (validated + clamped server-side)
 * - The server broadcasts compact snapshots: ~30 Hz while held, ~20 Hz while
 *   flying, ~1 Hz while resting. Ownership changes are sent reliably as
 *   discrete events that carry a full snapshot.
 * - Every client runs the same physics locally every animation frame. When a
 *   snapshot arrives it is fast-forwarded by the measured one-way latency,
 *   and the difference from the local prediction is folded into a visual
 *   error offset that decays over ~100 ms. Result: crisp bounces, no rubber
 *   banding, and no 60 fps packet spam.
 * - The holder is the exception: while you hold Claude your browser is the
 *   visual authority for your own screen (zero-latency drag), and it ignores
 *   snapshots until the server confirms your release (tracked by `epoch`).
 */

import type { ItemId } from "./items";
import type { Body } from "./physics";

export const SOCKET_PATH = "/rt";

/** Client → server drag packet interval. */
export const DRAG_SEND_MS = 33;
/** Client → server cursor-presence interval (only sent when near Claude). */
export const CURSOR_SEND_MS = 80;

/** Server snapshot cadence by situation. */
export const SNAP_HELD_MS = 33;
export const SNAP_MOVING_MS = 50;
export const SNAP_IDLE_MS = 1000;

/** Release faster than this counts as a "whip". */
export const WHIP_MIN_SPEED = 320;

export interface PlayerIdentity {
  id: string;
  name: string;
  color: string;
}

export interface GrabInfo extends PlayerIdentity {
  tx: number;
  ty: number;
  tvx: number;
  tvy: number;
  ox: number;
  oy: number;
}

/** Authoritative world state snapshot. */
export interface Snapshot extends Body {
  /** server time (ms since epoch) at which this state was valid */
  t: number;
  /** ownership epoch: increments on every grab and every release */
  e: number;
  /** homing (floating back to center) */
  h: 0 | 1;
  /** shared damage 0..1 (1 - hp/MAX_HP); 1 means dead */
  d: number;
  /** current holder, if any */
  g: GrabInfo | null;
}

export interface Stats {
  whips: number;
  topSpeed: number;
  kills: number;
  /** fastest kill ever (ms), the "time to beat" */
  bestKillMs: number | null;
  bestKiller: PlayerIdentity | null;
}

export const MAX_HP = 175;

/** Wall impacts below this speed don't hurt. */
export const HURT_MIN_SPEED = 900;
/** Impact speed per HP lost, and the per-hit cap. */
export const HURT_SPEED_PER_HP = 180;
export const HURT_MAX_PER_HIT = 10;

export function wallDamage(speed: number): number {
  return speed > HURT_MIN_SPEED ? Math.min(HURT_MAX_PER_HIT, (speed - HURT_MIN_SPEED) / HURT_SPEED_PER_HP) : 0;
}

/** client → server: use the equipped item at a pointer position */
export interface UseInput {
  item: ItemId;
  x: number;
  y: number;
}

/**
 * server → all: an item was used. Bombs send two events: "arm" when
 * thrown, "boom" when they go off. Others carry the post-hit world state.
 */
export interface UsedEvent {
  id: number;
  item: ItemId;
  who: PlayerIdentity;
  /** user's pointer, world units */
  x: number;
  y: number;
  phase: "hit" | "arm" | "boom";
  damage: number;
  /** HP actually restored (healing items) */
  heal: number;
  world: Snapshot | null;
}

/**
 * One life of Claude. The clock starts on the first grab after a revive (so
 * idle time doesn't count) and stops when his HP hits zero. HP itself
 * travels in every snapshot (`d` = 1 - hp/MAX_HP).
 */
export interface Round {
  id: number;
  alive: boolean;
  /** server time of the first grab this life; null = clock not started */
  startedAt: number | null;
  diedAt: number | null;
  killMs: number | null;
  /** whoever dealt the final blow */
  killer: PlayerIdentity | null;
  /** everyone who dealt damage this round */
  contributors: string[];
  /** true if this kill set the time to beat */
  record: boolean;
  /** who did what this life; filled in when he dies */
  board: Board | null;
}

export interface BoardEntry extends PlayerIdentity {
  /** HP removed (damage list) or restored (healing list) */
  amount: number;
}

/** End-of-life leaderboard, each list sorted high → low. */
export interface Board {
  damage: BoardEntry[];
  healing: BoardEntry[];
  totalDamage: number;
  totalHealing: number;
}

/** Entries kept per list, so most players can find their own row. */
export const BOARD_SIZE = 20;

export interface Welcome {
  you: PlayerIdentity;
  world: Snapshot;
  players: number;
  stats: Stats;
  round: Round;
}

/** Death screen must be up this long before anyone can revive. */
export const REVIVE_LOCK_MS = 1500;
/** Nobody revives him → he comes back on his own. */
export const AUTO_REVIVE_MS = 20000;

export type FeedKind = "fly" | "speed" | "crowd" | "join" | "slip" | "hurt" | "revive" | "knock" | "heal";

export interface FeedItem {
  id: number;
  text: string;
  kind: FeedKind;
  color?: string;
}

export type HypeKind = "launched" | "pinball" | "jumped" | "record" | "broken";

export interface Hype {
  id: number;
  kind: HypeKind;
  text: string;
}

// ---- client → server payloads ----

export interface GrabRequest {
  /** spring target (pointer world position, adjusted) */
  x: number;
  y: number;
  /** raw pointer world position (for hit validation) */
  px: number;
  py: number;
  /** grab point in Claude's local frame */
  ox: number;
  oy: number;
  /** client's visual radius in world units per axis (for hit validation) */
  rx: number;
  ry: number;
}

export type GrabResult =
  | { ok: true; epoch: number }
  | { ok: false; holder?: PlayerIdentity };

export interface DragInput {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface ReleaseInput {
  vx: number;
  vy: number;
  av: number;
  /** holder's locally simulated body at release time */
  bx: number;
  by: number;
  ba: number;
  /** estimated server time of the release */
  t: number;
}

export interface CursorInput {
  x: number;
  y: number;
}

export interface RemoteCursor extends PlayerIdentity {
  x: number;
  y: number;
}

export interface GrabbedEvent {
  who: PlayerIdentity;
  world: Snapshot;
}

export interface ReleasedEvent {
  who: PlayerIdentity;
  speed: number;
  world: Snapshot;
  /** server took him away (slip, knocked loose, timeout) */
  forced?: boolean;
}

/** Round to 0.1 to keep JSON packets small. */
export function r1(n: number): number {
  return Math.round(n * 10) / 10;
}
/** Round to 0.001 (angles). */
export function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
