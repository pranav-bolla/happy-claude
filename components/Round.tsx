"use client";

import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AUTO_REVIVE_MS,
  MAX_HP,
  REVIVE_LOCK_MS,
  type Board,
  type BoardEntry,
  type Round,
  type Stats,
} from "@/lib/protocol";

export function formatKill(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** Re-render every `ms` while `active`. */
function useTicker(active: boolean, ms = 100): void {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

const SEGMENTS = 20;

export function HealthBar({ hp, round, now }: { hp: number; round: Round | null; now: () => number }) {
  const controls = useAnimationControls();
  const prev = useRef(hp);
  useTicker(!!round?.alive && round.startedAt !== null);

  useEffect(() => {
    if (hp < prev.current) {
      void controls.start({ x: [0, -6, 6, -3, 0], transition: { duration: 0.28 } });
    } else if (hp > prev.current && prev.current > 0) {
      void controls.start({ scale: [1, 1.04, 1], transition: { duration: 0.3 } });
    }
    prev.current = hp;
  }, [hp, controls]);

  const alive = round?.alive ?? true;
  const elapsed = !round
    ? 0
    : !alive
      ? round.killMs ?? 0
      : round.startedAt === null
        ? 0
        : now() - round.startedAt;
  const frac = hp / MAX_HP;
  const color = frac > 0.5 ? "#22C55E" : frac > 0.25 ? "#F59E0B" : "#EF4444";
  const lit = Math.ceil((hp / MAX_HP) * SEGMENTS);

  return (
    <div className="pointer-events-none absolute left-1/2 top-[calc(max(1.25rem,env(safe-area-inset-top))+3rem)] -translate-x-1/2 lg:top-6">
      <motion.div
        animate={controls}
        className="w-[min(88vw,300px)] rounded-xl border border-black/[0.06] bg-white/70 px-3 pb-2.5 pt-2 shadow-[0_8px_24px_rgba(29,29,31,0.07)] backdrop-blur-xl"
      >
        <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] font-bold tracking-[0.14em] text-ink">
          <span>{alive ? "CLAUDE" : "CLAUDE ☠"}</span>
          <span style={{ color: alive ? color : "#6B6B6B" }}>
            {alive ? `${hp} HP` : "DECEASED"}
          </span>
          <span className="tabular-nums text-muted">⏱ {formatKill(elapsed)}</span>
        </div>
        <div className="flex gap-[3px]">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <div
              key={i}
              className="h-2.5 flex-1 transition-colors duration-150"
              style={{ background: i < lit ? color : "rgba(29,29,31,0.09)" }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

const SHOWN = 3;

function BoardList({
  title,
  total,
  unit,
  entries,
  color,
  myId,
  killerId,
  empty,
}: {
  title: string;
  total: number;
  unit: string;
  entries: BoardEntry[];
  color: string;
  myId: string | null;
  killerId?: string | null;
  empty: string;
}) {
  const top = entries[0]?.amount || 1;
  const myIndex = entries.findIndex((e) => e.id === myId);
  const rows = entries.slice(0, SHOWN).map((e, i) => ({ e, rank: i + 1 }));
  if (myIndex >= SHOWN) rows.push({ e: entries[myIndex], rank: myIndex + 1 });

  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[10px] tracking-[0.16em]">
        <span className="font-bold" style={{ color }}>
          {title}
        </span>
        {total > 0 && (
          <span className="text-white/40">
            {total} HP {unit}
          </span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-1.5 font-mono text-[11px] italic text-white/40">{empty}</p>
      ) : (
        <ol className="mt-1.5 space-y-1">
          {rows.map(({ e, rank }, i) => {
            const me = e.id === myId;
            return (
              <li key={e.id}>
                {i === SHOWN && <div className="mb-1 text-center font-mono text-[9px] leading-none text-white/30">···</div>}
                <div
                  className={`relative flex items-center gap-2 overflow-hidden px-1.5 py-[3px] font-mono text-[11px] ${me ? "outline outline-1 outline-white/40" : ""}`}
                >
                  <motion.div
                    className="absolute inset-y-0 left-0 opacity-25"
                    style={{ background: color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(e.amount / top) * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.4 + i * 0.08, ease: "easeOut" }}
                  />
                  <span className="relative w-4 text-white/40 tabular-nums">{rank}</span>
                  <span className="relative h-2 w-2 shrink-0" style={{ background: e.color }} />
                  <span className={`relative min-w-0 flex-1 truncate ${me ? "font-bold text-white" : "text-white/85"}`}>
                    {e.name}
                    {me && <span className="text-white/50"> (you)</span>}
                    {e.id === killerId && <span title="final blow"> ☠</span>}
                  </span>
                  <span className="relative font-bold tabular-nums text-white">{e.amount}</span>
                  {total > 0 && (
                    <span className="relative w-8 text-right tabular-nums text-white/40">
                      {Math.round((e.amount / total) * 100)}%
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Leaderboard({ board, killerId, myId }: { board: Board; killerId: string | null; myId: string | null }) {
  return (
    <div className="mt-4 space-y-3 border-t border-white/10 pt-3">
      <BoardList
        title="WHO DID THIS"
        total={board.totalDamage}
        unit="dealt"
        entries={board.damage}
        color="#D97757"
        myId={myId}
        killerId={killerId}
        empty="the wall did it. alone."
      />
      <BoardList
        title="WHO TRIED TO SAVE HIM"
        total={board.totalHealing}
        unit="healed"
        entries={board.healing}
        color="#22C55E"
        myId={myId}
        empty="nobody tried to save him."
      />
    </div>
  );
}

export function DeathScreen({
  round,
  stats,
  myBest,
  personalBest,
  helped,
  myId,
  now,
  onRevive,
}: {
  round: Round | null;
  stats: Stats;
  myBest: number | null;
  personalBest: boolean;
  helped: boolean;
  myId: string | null;
  now: () => number;
  onRevive: () => void;
}) {
  const dead = !!round && !round.alive;
  useTicker(dead, 250);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [round?.id]);

  const sinceDeath = dead && round?.diedAt ? now() - round.diedAt : 0;
  const locked = sinceDeath < REVIVE_LOCK_MS;
  const autoIn = Math.max(0, Math.ceil((AUTO_REVIVE_MS - sinceDeath) / 1000));

  const share = async () => {
    if (!round?.killMs) return;
    const text = `we killed Claude in ${formatKill(round.killMs)}. time to beat: ${formatKill(stats.bestKillMs)}. your turn →`;
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: "WHIP CLAUDE", text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setCopied(true);
      }
    } catch {
      /* user cancelled */
    }
  };

  return (
    <AnimatePresence>
      {dead && round && (
        <motion.div
          key={round.id}
          className="absolute inset-0 flex items-end justify-center bg-[radial-gradient(ellipse_at_center,rgba(29,29,31,0.08),rgba(29,29,31,0.45))] px-4 pb-[max(10rem,env(safe-area-inset-bottom))] sm:pb-40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.25 } }}
        >
          <motion.div
            initial={{ y: 30, scale: 0.9, rotate: -2 }}
            animate={{ y: 0, scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.25 }}
            className="pointer-events-auto max-h-[calc(100dvh-12rem)] w-full max-w-[360px] overflow-y-auto bg-ink p-5 text-cream shadow-[8px_8px_0_rgba(217,119,87,0.9)]"
          >
            <p className="font-mono text-[11px] font-bold tracking-[0.24em] text-claude">☠ CLAUDE IS DEAD</p>
            <p className="mt-2 font-mono text-[10px] tracking-[0.18em] text-white/50">KILLED IN</p>
            <p className="text-[52px] font-black leading-none tracking-tight tabular-nums">{formatKill(round.killMs)}</p>

            <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-white/70">
              <span>final blow:</span>
              {round.killer ? (
                <span className="flex items-center gap-1.5 font-bold text-white">
                  <span className="h-2 w-2" style={{ background: round.killer.color }} />
                  {round.killer.name}
                </span>
              ) : (
                <span className="font-bold text-white">the wall</span>
              )}
            </div>

            <div className="mt-3 space-y-1 font-mono text-[11px]">
              {round.record ? (
                <motion.p
                  animate={{ opacity: [1, 0.5, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity }}
                  className="font-bold text-claude"
                >
                  ★ NEW WORLD RECORD
                </motion.p>
              ) : (
                <p className="text-white/70">
                  time to beat: <b className="text-white">{formatKill(stats.bestKillMs)}</b>
                  {stats.bestKiller && <> by {stats.bestKiller.name}</>}
                </p>
              )}
              {helped && (
                <p className="text-white/70">
                  your best: <b className="text-white">{formatKill(myBest)}</b>
                  {personalBest && !round.record && <span className="ml-1.5 font-bold text-claude">NEW PB</span>}
                </p>
              )}
            </div>

            {round.board && <Leaderboard board={round.board} killerId={round.killer?.id ?? null} myId={myId} />}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={locked}
                onClick={onRevive}
                className="flex-1 bg-claude py-3 font-mono text-[13px] font-bold tracking-[0.16em] text-ink transition-transform hover:brightness-110 active:scale-[0.97] disabled:opacity-40"
              >
                {locked ? "..." : "REVIVE ↺"}
              </button>
              <button
                type="button"
                onClick={share}
                className="border border-white/20 px-4 font-mono text-[12px] font-bold tracking-[0.12em] text-white/90 transition-colors hover:bg-white/10"
              >
                {copied ? "COPIED" : "SHARE"}
              </button>
            </div>
            <p className="mt-2.5 text-center font-mono text-[10px] text-white/40">auto-revive in {autoIn}s</p>
            <Link
              href="/daily"
              className="mt-3 flex items-center justify-between border-t border-white/10 pt-3 font-mono text-[11px] font-bold tracking-[0.12em] text-claude transition-colors hover:text-white"
            >
              <span>WHILE YOU WAIT: DAILY CLAUDE</span>
              <span>→</span>
            </Link>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
