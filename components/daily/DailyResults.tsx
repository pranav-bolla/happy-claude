"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { DailyStats } from "@/lib/client/dailyStore";
import { ITEM_ART } from "@/lib/client/itemArt";
import { moveColor, msUntilNextDay, shareText, shareUrl, type DailyResult, type SharedRun } from "@/lib/daily";
import { ITEMS, type ItemId } from "@/lib/items";

export interface GlobalDaily {
  players: number;
  kills: number;
  dist: Record<number, number>;
}

function useCountdown(): string {
  const [ms, setMs] = useState(() => msUntilNextDay());
  useEffect(() => {
    const id = setInterval(() => setMs(msUntilNextDay()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** Share of OTHER players a kill did better than (everyone he survived, plus slower kills). */
function beatPct(r: DailyResult, g: GlobalDaily): number | null {
  if (g.players < 2 || !r.killed) return null;
  let beaten = g.players - g.kills;
  for (const [m, n] of Object.entries(g.dist)) if (Number(m) > r.moves) beaten += n;
  return Math.round((beaten / (g.players - 1)) * 100);
}

function versus(r: DailyResult, c: SharedRun): string {
  const theirs = c.grid.length;
  if (!r.killed && !c.killed) return "🎯 neither of you could KO him. tie.";
  if (!r.killed) return `🎯 they KO'd him in ${theirs}. you didn't.`;
  if (!c.killed || r.moves < theirs) return `🎯 you beat their ${c.killed ? theirs : "X"}. send it back.`;
  if (r.moves === theirs) return `🎯 tied with their ${theirs}.`;
  return `🎯 they got him in ${theirs}. so close.`;
}

/** Each move: the item used on top, how hard it hit below. */
export function RunGrid({
  actions,
  grid,
  killed,
  size,
  animate = false,
}: {
  actions?: ItemId[];
  grid: number[];
  killed: boolean;
  size: number;
  animate?: boolean;
}) {
  const icons = actions?.length === grid.length;
  return (
    <div className="flex flex-wrap gap-1">
      {grid.map((d, i) => {
        const isKill = killed && i === grid.length - 1;
        return (
          <motion.div
            key={i}
            initial={animate ? { scale: 0, rotate: -30 } : false}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.25 + i * 0.07, type: "spring", stiffness: 500, damping: 20 }}
            title={`${icons ? `${ITEMS[actions[i]].name}: ` : ""}${Math.round(d)} damage`}
            className="flex flex-col gap-0.5"
            style={{ width: size }}
          >
            {icons && (
              <span
                className="bg-white/10 p-[3px] [image-rendering:pixelated]"
                style={{ width: size, height: size }}
                dangerouslySetInnerHTML={{ __html: ITEM_ART[actions[i]] }}
              />
            )}
            <span
              className="flex items-center justify-center"
              style={{
                width: size,
                height: size,
                fontSize: size * 0.5,
                background: isKill ? "#0b0b0c" : moveColor(d),
                outline: d < 1 && !isKill ? "1px solid rgba(255,255,255,0.15)" : undefined,
              }}
            >
              {isKill ? "💀" : ""}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

export function DailyResults({
  result: r,
  stats,
  global,
  day,
  challenge,
}: {
  result: DailyResult;
  stats: DailyStats;
  global: GlobalDaily | null;
  day: number;
  challenge?: SharedRun | null;
}) {
  const countdown = useCountdown();
  const [copied, setCopied] = useState(false);
  const winPct = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  const pct = global ? beatPct(r, global) : null;

  const buckets = Math.max(r.maxMoves, ...Object.keys(stats.dist).map(Number), 1);
  const rows = Array.from({ length: buckets }, (_, i) => i + 1).filter(
    (m) => m <= r.maxMoves || stats.dist[m],
  );
  const maxCount = Math.max(1, ...Object.values(stats.dist), stats.fails);

  const share = async () => {
    const url = shareUrl(window.location.origin, r);
    try {
      if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        await navigator.share({ text: shareText(r, stats.streak), url });
      } else {
        await navigator.clipboard.writeText(shareText(r, stats.streak, url));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <motion.div
      className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-[radial-gradient(ellipse_at_center,rgba(29,29,31,0.15),rgba(29,29,31,0.55))] px-4 py-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        initial={{ y: 30, scale: 0.92, rotate: -2 }}
        animate={{ y: 0, scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 24, delay: 0.1 }}
        className="my-auto w-full max-w-[380px] bg-ink p-5 text-cream shadow-[8px_8px_0_rgba(217,119,87,0.9)]"
      >
        <p className="font-mono text-[11px] font-bold tracking-[0.24em] text-claude">
          DAILY CLAUDE #{day} · {r.modifier.toUpperCase()}
        </p>

        {r.killed ? (
          <>
            <p className="mt-2 font-mono text-[10px] tracking-[0.18em] text-white/50">KILLED IN</p>
            <p className="text-[52px] font-black leading-none tracking-tight tabular-nums">
              {r.moves}
              <span className="text-[24px] text-white/40">/{r.maxMoves}</span>
              <span className="ml-2 text-[20px] font-bold text-white/60">moves</span>
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-[40px] font-black leading-none tracking-tight">he survived.</p>
            <p className="mt-1 font-mono text-[11px] text-white/60">
              {r.hpLeft} HP left after {r.maxMoves} moves. he&apos;s smug about it.
            </p>
          </>
        )}

        <div className="mt-3">
          <RunGrid actions={r.actions} grid={r.grid} killed={r.killed} size={28} animate />
        </div>

        {challenge && (
          <p className="mt-3 font-mono text-[11px] font-bold text-claude">{versus(r, challenge)}</p>
        )}

        {global && (
          <p className="mt-3 font-mono text-[11px] text-white/70">
            {global.players} {global.players === 1 ? "player" : "players"} today · {global.kills} killed him
            {pct !== null && r.killed && (
              <>
                {" "}
                · you beat <b className="text-claude">{pct}%</b>
              </>
            )}
          </p>
        )}

        <button
          type="button"
          onClick={share}
          className="mt-4 w-full bg-claude py-3 font-mono text-[13px] font-bold tracking-[0.16em] text-ink transition-transform hover:brightness-110 active:scale-[0.97]"
        >
          {copied ? "COPIED ✓" : "SHARE RESULT"}
        </button>

        <div className="mt-5 grid grid-cols-4 gap-1 text-center">
          {[
            [stats.played, "played"],
            [winPct, "win %"],
            [stats.streak, "streak"],
            [stats.maxStreak, "best"],
          ].map(([v, label]) => (
            <div key={label}>
              <p className="text-[24px] font-black leading-none tabular-nums">{v}</p>
              <p className="mt-1 font-mono text-[9px] tracking-[0.12em] text-white/50">{label}</p>
            </div>
          ))}
        </div>

        <p className="mt-5 font-mono text-[10px] tracking-[0.16em] text-white/50">MOVES TO KILL</p>
        <div className="mt-1.5 space-y-[3px] font-mono text-[10px]">
          {rows.map((m) => {
            const n = stats.dist[m] ?? 0;
            const today = r.killed && r.moves === m;
            return (
              <div key={m} className="flex items-center gap-1.5">
                <span className="w-4 text-right text-white/50 tabular-nums">{m}</span>
                <div
                  className={`flex h-4 min-w-[1.25rem] items-center justify-end px-1 font-bold ${today ? "bg-claude text-ink" : "bg-white/15"}`}
                  style={{ width: `${Math.max(6, (n / maxCount) * 100)}%` }}
                >
                  {n}
                </div>
              </div>
            );
          })}
          <div className="flex items-center gap-1.5">
            <span className="w-4 text-right text-white/50">X</span>
            <div
              className={`flex h-4 min-w-[1.25rem] items-center justify-end px-1 font-bold ${!r.killed ? "bg-white/60 text-ink" : "bg-white/15"}`}
              style={{ width: `${Math.max(6, (stats.fails / maxCount) * 100)}%` }}
            >
              {stats.fails}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
          <div>
            <p className="font-mono text-[9px] tracking-[0.16em] text-white/50">NEXT CLAUDE IN</p>
            <p className="font-mono text-[20px] font-black tabular-nums">{countdown}</p>
          </div>
          <Link
            href="/"
            className="border border-white/25 px-3 py-2 font-mono text-[11px] font-bold tracking-[0.12em] text-white/90 transition-colors hover:bg-white/10"
          >
            JOIN THE MOB →
          </Link>
        </div>
      </motion.div>
    </motion.div>
  );
}
