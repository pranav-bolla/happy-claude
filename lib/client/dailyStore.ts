/**
 * Daily results live in this browser (like Wordle). One result per puzzle;
 * streaks and the guess distribution are derived from that history.
 */
import type { DailyResult } from "../daily";

const KEY = "whip-claude:daily";
const SEEN_RULES_KEY = "whip-claude:daily-rules";
const ID_KEY = "whip-claude:daily-id";

/** Random id so the global stats count this browser once per puzzle. */
export function playerId(): string {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

/** crypto.randomUUID needs HTTPS, which a phone on the LAN dev URL doesn't have. */
function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join("-");
}

type History = Record<number, DailyResult>;

function load(): History {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as History) : {};
  } catch {
    return {};
  }
}

export function getResult(day: number): DailyResult | null {
  return load()[day] ?? null;
}

export function saveResult(r: DailyResult): void {
  const h = load();
  if (h[r.day]) return; // first result of the day is final
  h[r.day] = r;
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    /* private mode */
  }
}

export interface DailyStats {
  played: number;
  wins: number;
  streak: number;
  maxStreak: number;
  /** moves → number of kills that took that many moves */
  dist: Record<number, number>;
  fails: number;
}

/** A streak is consecutive days with a kill; it survives until you miss a day. */
export function getStats(today: number): DailyStats {
  const h = load();
  const days = Object.keys(h)
    .map(Number)
    .sort((a, b) => a - b);
  const dist: Record<number, number> = {};
  let wins = 0;
  let fails = 0;
  let maxStreak = 0;
  let run = 0;
  let prev = -Infinity;
  for (const d of days) {
    const r = h[d];
    if (r.killed) {
      wins++;
      dist[r.moves] = (dist[r.moves] ?? 0) + 1;
      run = d === prev + 1 ? run + 1 : 1;
      maxStreak = Math.max(maxStreak, run);
    } else {
      fails++;
      run = 0;
    }
    prev = d;
  }
  // current streak only counts if it reaches today or yesterday
  const last = days[days.length - 1];
  const streak = last !== undefined && last >= today - 1 && h[last].killed ? run : 0;
  return { played: days.length, wins, streak, maxStreak, dist, fails };
}

export function hasSeenRules(): boolean {
  try {
    return localStorage.getItem(SEEN_RULES_KEY) === "1";
  } catch {
    return true;
  }
}

export function markRulesSeen(): void {
  try {
    localStorage.setItem(SEEN_RULES_KEY, "1");
  } catch {
    /* ignore */
  }
}
