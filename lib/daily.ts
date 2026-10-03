/**
 * Daily Claude: one solo puzzle per day, identical for everyone.
 *
 * Everything about the day (modifier, bumpers, spiked walls, loadout) comes
 * from a seeded PRNG keyed on the puzzle number, so every player on the same
 * local date gets the same arena. The run itself happens entirely on-device
 * with the shared physics (lib/physics.ts).
 *
 * Score: moves used to kill him (every grab or item use = 1 move), lower is
 * better. Run out of moves with HP left and he survives.
 */
import { RADIUS, type Peg, type PhysicsTune } from "./physics";
import type { ItemId } from "./items";

/** Puzzle #1 is this local date. */
const EPOCH = Date.UTC(2026, 9, 1);
const DAY_MS = 86_400_000;

export const DAILY_ARENA = 1200;

export type Side = "left" | "right" | "top" | "bottom";

export interface Modifier {
  id: string;
  name: string;
  blurb: string;
  tune: PhysicsTune;
  /** multiplier on wall/bumper damage */
  wallMul: number;
  hp?: number;
  moves?: number;
  pegs?: number;
  spikes?: number;
  /** extra uses added to each item in the loadout */
  extraItems?: number;
}

const MODIFIERS: Modifier[] = [
  { id: "classic", name: "Classic", blurb: "just you and him.", tune: {}, wallMul: 1 },
  { id: "rubber", name: "Rubber Claude", blurb: "extra bouncy today.", tune: { restitution: 0.94 }, wallMul: 1 },
  { id: "greased", name: "Greased", blurb: "he barely slows down.", tune: { drag: 0.3 }, wallMul: 1 },
  {
    id: "armored",
    name: "Armored",
    blurb: "walls only hurt half as much. use your tools.",
    tune: {},
    wallMul: 0.5,
    extraItems: 1,
  },
  { id: "glass", name: "Glass Jaw", blurb: "walls hurt double. only 6 moves.", tune: {}, wallMul: 2, moves: 6 },
  { id: "pinball", name: "Pinball", blurb: "bumpers everywhere.", tune: { restitution: 0.85 }, wallMul: 1, pegs: 6 },
  { id: "heavy", name: "Heavy", blurb: "he ate. throws don't go far. 12 moves.", tune: { drag: 2.4 }, wallMul: 1, moves: 12 },
  { id: "spiked", name: "Spike Pit", blurb: "two walls are spiked.", tune: {}, wallMul: 1, spikes: 2 },
];

export interface DailySpec {
  day: number;
  modifier: Modifier;
  hp: number;
  moves: number;
  arena: number;
  start: { x: number; y: number };
  pegs: Peg[];
  /** walls that deal double damage */
  spikes: Side[];
  /** how many uses of each item you get (hand is unlimited, within moves) */
  loadout: Partial<Record<ItemId, number>>;
}

export function dayNumber(d = new Date()): number {
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((local - EPOCH) / DAY_MS) + 1;
}

export function msUntilNextDay(d = new Date()): number {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return next.getTime() - d.getTime();
}

/** Small, fast, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dailySpec(day: number): DailySpec {
  const rand = mulberry32(day * 2654435761);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const pickOne = <T>(list: T[]) => list[Math.floor(rand() * list.length)];

  // never the same modifier two days running
  const prev = day > 1 ? modifierIndex(day - 1) : -1;
  let mi = modifierIndex(day);
  if (mi === prev) mi = (mi + 1) % MODIFIERS.length;
  const modifier = MODIFIERS[mi];

  const A = DAILY_ARENA;
  const start = { x: A / 2, y: A / 2 };

  // Bumpers: keep a Claude-sized gap between each other and the walls so
  // he can never get wedged.
  const pegs: Peg[] = [];
  const want = modifier.pegs ?? int(2, 4);
  const gap = RADIUS * 2 + 30;
  for (let tries = 0; tries < 400 && pegs.length < want; tries++) {
    const r = int(40, 62);
    const lo = r + gap;
    const hi = A - r - gap;
    const p = { x: lo + rand() * (hi - lo), y: lo + rand() * (hi - lo), r };
    if (Math.hypot(p.x - start.x, p.y - start.y) < RADIUS + r + 70) continue;
    if (pegs.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < p.r + q.r + gap)) continue;
    pegs.push({ x: Math.round(p.x), y: Math.round(p.y), r });
  }

  const sides: Side[] = ["left", "right", "top", "bottom"];
  const spikes: Side[] = [];
  const spikeCount = modifier.spikes ?? 1;
  while (spikes.length < spikeCount) {
    const s = pickOne(sides);
    if (!spikes.includes(s)) spikes.push(s);
  }

  const extra = modifier.extraItems ?? 0;
  const loadout: Partial<Record<ItemId, number>> = {
    whip: int(2, 4) + extra,
    hammer: int(0, 2) + extra,
    taser: int(0, 1) + extra,
    bomb: (rand() < 0.55 ? 1 : 0) + extra,
  };
  // always at least two tools to play with
  if (!loadout.hammer && !loadout.bomb) loadout.hammer = 1;
  for (const k of Object.keys(loadout) as ItemId[]) if (!loadout[k]) delete loadout[k];

  return {
    day,
    modifier,
    hp: modifier.hp ?? 150,
    moves: modifier.moves ?? 10,
    arena: A,
    start,
    pegs,
    spikes,
    loadout,
  };
}

function modifierIndex(day: number): number {
  return Math.floor(mulberry32(day * 7919 + 13)() * MODIFIERS.length);
}

/** Same buckets as moveSquare, as colours for the on-screen tracker. */
export function moveColor(damage: number): string {
  if (damage < 1) return "#1D1D1F";
  if (damage < 12) return "#FACC15";
  if (damage < 30) return "#F97316";
  return "#DC2626";
}

/** Wordle-style square for one move's damage. */
export function moveSquare(damage: number, killing: boolean): string {
  if (killing) return "💀";
  if (damage < 1) return "⬛";
  if (damage < 12) return "🟨";
  if (damage < 30) return "🟧";
  return "🟥";
}

export interface DailyResult {
  day: number;
  killed: boolean;
  /** moves actually used */
  moves: number;
  maxMoves: number;
  /** ms from first move to the kill (or to giving up) */
  ms: number;
  hpLeft: number;
  /** damage dealt by each move */
  grid: number[];
  modifier: string;
}

/** Omit `url` when the share sheet attaches it separately (that's what gets a link preview). */
export function shareText(r: DailyResult, streak: number, url?: string): string {
  const head = `Daily Claude #${r.day} ${r.killed ? "💀" : "😇"} ${r.killed ? r.moves : "X"}/${r.maxMoves}`;
  const squares = r.grid.map((d, i) => moveSquare(d, r.killed && i === r.grid.length - 1)).join("");
  const lines = [head, r.modifier, squares];
  if (!r.killed) lines.push(`he survived with ${Math.ceil(r.hpLeft)} HP`);
  if (streak > 1) lines.push(`🔥 ${streak} day streak`);
  if (url) lines.push(url);
  return lines.join("\n");
}
