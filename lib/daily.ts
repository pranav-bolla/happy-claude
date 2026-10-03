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

/** 0 = whiff, 1 = light, 2 = solid, 3 = huge. */
export type Bucket = 0 | 1 | 2 | 3;

export function damageBucket(damage: number): Bucket {
  if (damage < 1) return 0;
  if (damage < 12) return 1;
  if (damage < 30) return 2;
  return 3;
}

const BUCKET_COLORS = ["#1D1D1F", "#FACC15", "#F97316", "#DC2626"];
const BUCKET_SQUARES = ["⬛", "🟨", "🟧", "🟥"];
/** Damage that lands in each bucket, for drawing decoded results. */
const BUCKET_DAMAGE = [0, 6, 20, 40];

/** Colour of one move's damage on the on-screen tracker. */
export function moveColor(damage: number): string {
  return BUCKET_COLORS[damageBucket(damage)];
}

/** Wordle-style square for one move's damage. */
export function moveSquare(damage: number, killing: boolean): string {
  return killing ? "💀" : BUCKET_SQUARES[damageBucket(damage)];
}

/** What each move was, for the share text. */
export const MOVE_EMOJI: Partial<Record<ItemId, string>> = {
  hand: "✋",
  whip: "🪢",
  hammer: "🔨",
  taser: "⚡",
  bomb: "💣",
};

const MOVE_CODE: Partial<Record<ItemId, string>> = { hand: "h", whip: "w", hammer: "m", taser: "t", bomb: "b" };
const CODE_MOVE = Object.fromEntries(Object.entries(MOVE_CODE).map(([k, v]) => [v, k])) as Record<string, ItemId>;

/** A result shrunk to fit in a link, e.g. "3k-h1w2m0h3b2h3" (day, KO or not, move + bucket pairs). */
export interface SharedRun {
  day: number;
  killed: boolean;
  actions: ItemId[];
  grid: number[];
}

export function encodeRun(r: DailyResult): string | null {
  if (!r.actions || r.actions.length !== r.grid.length) return null;
  const pairs = r.actions.map((a, i) => `${MOVE_CODE[a] ?? "h"}${damageBucket(r.grid[i])}`).join("");
  return `${r.day}${r.killed ? "k" : "x"}-${pairs}`;
}

export function decodeRun(code: string | undefined | null): SharedRun | null {
  const m = /^(\d{1,5})([kx])-((?:[hwmtb][0-3]){1,20})$/.exec(code ?? "");
  if (!m) return null;
  const pairs = m[3].match(/../g)!;
  return {
    day: Number(m[1]),
    killed: m[2] === "k",
    actions: pairs.map((p) => CODE_MOVE[p[0]]),
    grid: pairs.map((p) => BUCKET_DAMAGE[Number(p[1])]),
  };
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
  /** what each move was (missing on results saved before this was tracked) */
  actions?: ItemId[];
  modifier: string;
}

/**
 * Two rows: what you did, then how hard it hit.
 * Omit `url` when the share sheet attaches it separately (that's what gets a link preview).
 */
export function shareText(r: DailyResult, streak: number, url?: string): string {
  const head =
    `Daily Claude #${r.day} ${r.killed ? "💀" : "😇"} ${r.killed ? r.moves : "X"}/${r.maxMoves}` +
    (isOneShot(r) ? " 🏆 ONE-SHOT" : "");
  const squares = r.grid.map((d, i) => moveSquare(d, r.killed && i === r.grid.length - 1)).join("");
  const lines = [head];
  if (r.actions?.length === r.grid.length) lines.push(r.actions.map((a) => MOVE_EMOJI[a] ?? "✋").join(""));
  lines.push(squares);
  const tail = [r.modifier];
  if (!r.killed) tail.push(`he survived with ${Math.ceil(r.hpLeft)} HP`);
  if (streak > 1) tail.push(`🔥 ${streak}`);
  lines.push(tail.join(" · "));
  if (url) lines.push(url);
  return lines.join("\n");
}

/** KO'd in a single move. Only possible on some days (bouncy or double-damage walls). */
export function isOneShot(r: { killed: boolean; grid: number[] }): boolean {
  return r.killed && r.grid.length === 1;
}

/** Link to /daily that carries the result, so the link preview shows this run. */
export function shareUrl(origin: string, r: DailyResult): string {
  const code = encodeRun(r);
  return `${origin}/daily${code ? `?r=${code}` : ""}`;
}
