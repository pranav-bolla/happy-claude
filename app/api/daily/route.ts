import { NextResponse, type NextRequest } from "next/server";
import { dayNumber } from "@/lib/daily";

/**
 * Global Daily Claude results, so players can see how they compare.
 * In memory (resets on redeploy); one submission per IP per puzzle.
 */
interface DayStats {
  players: number;
  kills: number;
  dist: Record<number, number>;
  seen: Set<string>;
}

const g = globalThis as unknown as { __dailyStats?: Map<number, DayStats> };
const store = (g.__dailyStats ??= new Map());

function statsFor(day: number): DayStats {
  let s = store.get(day);
  if (!s) {
    s = { players: 0, kills: 0, dist: {}, seen: new Set() };
    store.set(day, s);
    // keep a week
    for (const d of store.keys()) if (d < day - 7) store.delete(d);
  }
  return s;
}

/** Players' local dates can be a day either side of the server's. */
function validDay(day: unknown): day is number {
  const today = dayNumber();
  return Number.isInteger(day) && Math.abs((day as number) - today) <= 1;
}

function view(s: DayStats) {
  return { players: s.players, kills: s.kills, dist: s.dist };
}

export async function GET(req: NextRequest) {
  const day = Number(req.nextUrl.searchParams.get("day"));
  if (!validDay(day)) return NextResponse.json({ error: "bad day" }, { status: 400 });
  return NextResponse.json(view(statsFor(day)));
}

export async function POST(req: NextRequest) {
  let body: { day?: unknown; killed?: unknown; moves?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { day, killed, moves } = body;
  if (!validDay(day) || typeof killed !== "boolean" || !Number.isInteger(moves) || (moves as number) < 1 || (moves as number) > 20) {
    return NextResponse.json({ error: "bad result" }, { status: 400 });
  }
  const s = statsFor(day);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  if (!s.seen.has(ip)) {
    s.seen.add(ip);
    s.players++;
    if (killed) {
      s.kills++;
      s.dist[moves as number] = (s.dist[moves as number] ?? 0) + 1;
    }
  }
  return NextResponse.json(view(s));
}
