import { NextResponse, type NextRequest } from "next/server";
import { dayNumber } from "@/lib/daily";
import { dailyStats } from "@/lib/server/dailyStats";

/** Global Daily Claude results, so players can see how they compare. */

/** Players' local dates can be a day either side of the server's. */
function validDay(day: unknown): day is number {
  const today = dayNumber();
  return Number.isInteger(day) && Math.abs((day as number) - today) <= 1;
}

function unavailable(e: unknown) {
  console.error("[daily] stats unavailable:", e);
  return NextResponse.json({ error: "stats unavailable" }, { status: 503 });
}

export async function GET(req: NextRequest) {
  const day = Number(req.nextUrl.searchParams.get("day"));
  if (!validDay(day)) return NextResponse.json({ error: "bad day" }, { status: 400 });
  try {
    return NextResponse.json(await dailyStats.get(day));
  } catch (e) {
    return unavailable(e);
  }
}

export async function POST(req: NextRequest) {
  let body: { day?: unknown; id?: unknown; killed?: unknown; moves?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const { day, id, killed, moves } = body;
  if (
    !validDay(day) ||
    typeof id !== "string" ||
    !/^[\w-]{8,64}$/.test(id) ||
    typeof killed !== "boolean" ||
    !Number.isInteger(moves) ||
    (moves as number) < 1 ||
    (moves as number) > 20
  ) {
    return NextResponse.json({ error: "bad result" }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  try {
    return NextResponse.json(await dailyStats.submit({ day, id, ip, killed, moves: moves as number }));
  } catch (e) {
    return unavailable(e);
  }
}
