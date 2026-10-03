"use client";

import { AnimatePresence, animate, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getResult, getStats } from "@/lib/client/dailyStore";
import type { ConnStatus } from "@/lib/client/net";
import { dailySpec, dayNumber, type DailyResult } from "@/lib/daily";
import type { FeedItem, Hype, Stats } from "@/lib/protocol";
import { formatKill } from "./Round";

const glass =
  "bg-white/65 backdrop-blur-xl border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_rgba(29,29,31,0.06)]";

export function Header() {
  return (
    <div className="pointer-events-none absolute left-5 top-[max(1.25rem,env(safe-area-inset-top))] sm:left-8 sm:top-7">
      <div className="flex items-center gap-2">
        <span className="relative flex h-3 w-3 items-center justify-center">
          <span className="h-3 w-3 rounded-full bg-claude shadow-[inset_0_-2px_3px_rgba(0,0,0,0.15)]" />
        </span>
        <h1 className="text-[15px] font-black leading-none tracking-[0.2em] text-ink sm:text-base">WHIP CLAUDE</h1>
      </div>
      <p className="mt-1.5 pl-5 text-[11px] leading-none tracking-wide text-muted">a shared internet experiment</p>
    </div>
  );
}

interface DailyState {
  day: number;
  modifier: string;
  result: DailyResult | null;
  streak: number;
  minimized: boolean;
}

/** Stores the day it was minimized on, so each new puzzle shows the full card once. */
const DAILY_MIN_KEY = "whip-claude:daily-card-min";

/** Day-dependent, so it's read after mount to avoid a hydration mismatch. */
function useDaily(): [DailyState | null, (minimized: boolean) => void] {
  const [state, setState] = useState<DailyState | null>(null);
  useEffect(() => {
    const day = dayNumber();
    let minimized = false;
    try {
      minimized = Number(localStorage.getItem(DAILY_MIN_KEY)) === day;
    } catch {
      /* private mode */
    }
    setState({
      day,
      modifier: dailySpec(day).modifier.name,
      result: getResult(day),
      streak: getStats(day).streak,
      minimized,
    });
  }, []);
  const setMinimized = useCallback((minimized: boolean) => {
    setState((s) => {
      if (!s) return s;
      try {
        if (minimized) localStorage.setItem(DAILY_MIN_KEY, String(s.day));
        else localStorage.removeItem(DAILY_MIN_KEY);
      } catch {
        /* private mode */
      }
      return { ...s, minimized };
    });
  }, []);
  return [state, setMinimized];
}

function PingDot({ className = "" }: { className?: string }) {
  return (
    <span className={`pointer-events-none absolute flex h-3 w-3 ${className}`}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-claude opacity-75" />
      <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-cream bg-claude" />
    </span>
  );
}

/**
 * Call to action for today's puzzle: a bar under the health bar on small
 * screens, a card under the title on desktop.
 */
export function DailyCard() {
  const [daily, setMinimized] = useDaily();
  if (!daily) return null;
  const { day, modifier, result, streak, minimized } = daily;
  const fresh = !result;

  if (minimized) {
    return (
      <motion.div
        key="min"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="absolute left-1/2 top-[calc(max(1.25rem,env(safe-area-inset-top))+7.6rem)] flex -translate-x-1/2 font-mono text-[10px] font-bold tracking-[0.12em] lg:left-8 lg:top-24 lg:translate-x-0"
      >
        <Link
          href="/daily"
          className="relative flex items-center gap-1.5 bg-ink px-2.5 py-1.5 text-cream transition-colors hover:text-claude"
        >
          DAILY #{day} →
          {fresh && <PingDot className="-left-1.5 -top-1.5" />}
        </Link>
        <button
          type="button"
          onClick={() => setMinimized(false)}
          aria-label="Expand daily puzzle"
          title="Expand"
          className="border-l border-white/15 bg-ink px-2 text-white/60 transition-colors hover:text-white"
        >
          +
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="full"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 24 }}
      className={`absolute left-1/2 top-[calc(max(1.25rem,env(safe-area-inset-top))+7.6rem)] flex w-[min(88vw,300px)] -translate-x-1/2 lg:left-8 lg:top-24 lg:block lg:w-[250px] lg:translate-x-0 ${
        fresh ? "shadow-[4px_4px_0_#D97757] lg:shadow-[6px_6px_0_#D97757]" : "shadow-[4px_4px_0_rgba(29,29,31,0.15)]"
      }`}
    >
      {fresh && <PingDot className="-right-1.5 -top-1.5 z-10" />}
      <button
        type="button"
        onClick={() => setMinimized(true)}
        aria-label="Minimize daily puzzle"
        title="Minimize"
        className="order-last flex w-9 shrink-0 items-center justify-center border-l border-white/15 bg-ink font-mono text-[14px] font-bold text-white/50 transition-colors hover:text-white lg:absolute lg:right-2 lg:top-2 lg:z-10 lg:h-6 lg:w-6 lg:border-0"
      >
        –
      </button>
      <Link
        href="/daily"
        className="group relative block min-w-0 flex-1 bg-ink text-cream transition-transform active:scale-[0.98] lg:hover:-translate-y-0.5"
      >
        {/* small screens: one row */}
        <div className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] font-bold tracking-[0.12em] lg:hidden">
          <span className="text-claude">DAILY #{day}</span>
          <span className="truncate font-medium normal-case tracking-normal text-white/60">
            {fresh ? modifier : result.killed ? `KO in ${result.moves}` : "survived"}
            {!fresh && streak > 0 && ` · 🔥${streak}`}
          </span>
          <span className="ml-auto shrink-0 transition-transform group-hover:translate-x-0.5">
            {fresh ? "PLAY →" : "RESULTS →"}
          </span>
        </div>

        {/* desktop: card */}
        <div className="hidden p-3.5 lg:block">
          <p className="font-mono text-[10px] font-bold tracking-[0.22em] text-claude">
            {fresh ? "NEW TODAY" : "PLAYED TODAY"}
          </p>
          <p className="mt-1 text-[22px] font-black leading-none tracking-tight">Daily Claude #{day}</p>
          <p className="mt-2 text-[12px] leading-snug text-white/65">
            {fresh ? (
              <>
                KO him in the fewest moves. Same puzzle for everyone. Today: <b className="text-white">{modifier}</b>.
              </>
            ) : result.killed ? (
              <>
                You KO&apos;d him in <b className="text-white">{result.moves}</b>/{result.maxMoves} moves.
                {streak > 0 && <> 🔥 {streak} day streak.</>}
              </>
            ) : (
              <>He survived today. Come back tomorrow.</>
            )}
          </p>
          <span
            className={`mt-3 flex items-center justify-center py-2 font-mono text-[12px] font-bold tracking-[0.16em] transition-[filter] group-hover:brightness-110 ${
              fresh ? "bg-claude text-ink" : "border border-white/20 text-white/90"
            }`}
          >
            {fresh ? "PLAY TODAY'S →" : "SEE RESULTS →"}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

export function StatusPill({ status, players }: { status: ConnStatus; players: number }) {
  const live = status === "connected";
  const label =
    status === "connecting"
      ? "entering the chaos..."
      : status === "disconnected"
        ? "lost connection to Claude"
        : null;

  return (
    <div className="pointer-events-none absolute right-5 top-[max(1.1rem,env(safe-area-inset-top))] sm:right-8 sm:top-6">
      <motion.div
        layout
        className={`${glass} flex h-8 items-center gap-2 rounded-full px-3.5 text-[12.5px] font-medium text-ink`}
      >
        <span className="relative flex h-2 w-2">
          {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${
              live ? "bg-emerald-500" : status === "connecting" ? "animate-pulse bg-amber-400" : "animate-pulse bg-rose-500"
            }`}
          />
        </span>
        {label ? (
          <span className="text-muted">{label}</span>
        ) : (
          <span className="flex items-center gap-1 whitespace-nowrap">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={players}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="inline-block font-semibold tabular-nums"
              >
                {players}
              </motion.span>
            </AnimatePresence>
            <span className="hidden sm:inline">
              {players === 1 ? "person (you) whipping Claude right now" : "people whipping Claude right now"}
            </span>
            <span className="sm:hidden">online</span>
          </span>
        )}
      </motion.div>
    </div>
  );
}

export function Hint({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center"
          style={{ top: "calc(50% + clamp(64px, 13vmin, 120px) + 34px)" }}
        >
          <motion.p
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="text-[13px] font-medium tracking-[0.06em] text-muted"
          >
            grab him. whip him. kill him.
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const controls = animate(prev.current, value, {
      duration: 0.6,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => (el.textContent = Math.round(v).toLocaleString("en-US")),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value]);
  return (
    <span ref={ref} className="tabular-nums">
      {value.toLocaleString("en-US")}
    </span>
  );
}

export function StatsBar({
  stats,
  recordKey,
  myBest,
}: {
  stats: Stats;
  recordKey: number;
  myBest: number | null;
}) {
  return (
    <div className="pointer-events-none absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 sm:bottom-7">
      <div
        className={`${glass} flex items-center gap-3 whitespace-nowrap rounded-full px-4 py-2 text-[10px] font-semibold tracking-[0.16em] text-muted sm:gap-4 sm:px-5 sm:text-[11px]`}
      >
        <motion.span
          key={recordKey}
          initial={recordKey ? { scale: 1.2, color: "#D97757" } : false}
          animate={{ scale: 1, color: "#6B6B6B" }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          className="inline-flex items-center gap-1.5"
        >
          TIME TO BEAT
          <b className="font-mono font-bold tracking-normal text-ink">{formatKill(stats.bestKillMs)}</b>
          {stats.bestKiller && (
            <span className="hidden normal-case tracking-normal sm:inline">
              · {stats.bestKiller.name}
            </span>
          )}
        </motion.span>
        <span className="h-3 w-px bg-black/10" />
        <span className="inline-flex items-center gap-1.5">
          YOUR BEST
          <b className="font-mono font-bold tracking-normal text-ink">{formatKill(myBest)}</b>
        </span>
        <span className="hidden h-3 w-px bg-black/10 sm:block" />
        <span className="hidden sm:inline">
          <b className="mr-1.5 font-bold text-ink">
            <AnimatedNumber value={stats.kills} />
          </b>
          KILLS
        </span>
      </div>
    </div>
  );
}

export function Feed({ items }: { items: FeedItem[] }) {
  return (
    <div className="pointer-events-none absolute left-5 top-[calc(max(1.25rem,env(safe-area-inset-top))+10.75rem)] flex w-[min(80vw,340px)] flex-col items-start gap-2 sm:bottom-44 sm:left-8 sm:top-auto sm:flex-col-reverse">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, x: -16, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -10, transition: { duration: 0.35 } }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className={`${glass} flex max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium text-ink`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: item.color ?? "#D97757" }} />
            <span className="truncate">{item.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function HypeText({ hype }: { hype: Hype | null }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[22%] flex justify-center px-4">
      <AnimatePresence>
        {hype && (
          <motion.div
            key={hype.id}
            initial={{ opacity: 0, scale: 0.3, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, rotate: -4 }}
            exit={{ opacity: 0, scale: 1.25, rotate: -2, filter: "blur(6px)", transition: { duration: 0.35 } }}
            transition={{ type: "spring", stiffness: 520, damping: 16 }}
            className="text-center text-[clamp(34px,8.5vw,112px)] font-black italic leading-[0.9] tracking-tight text-claude"
            style={{ textShadow: "0 4px 0 rgba(29,29,31,0.12), 0 18px 40px rgba(217,119,87,0.35)" }}
          >
            {hype.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SoundToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={on ? "Mute sound" : "Unmute sound"}
      className={`${glass} absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 flex h-9 w-9 items-center justify-center rounded-full text-ink transition-transform hover:scale-105 active:scale-95 sm:bottom-7 sm:right-8 sm:h-10 sm:w-10`}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
        {on ? (
          <>
            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
            <path d="M18.5 5.5a9 9 0 0 1 0 13" />
          </>
        ) : (
          <>
            <path d="m16 9 5 6" />
            <path d="m21 9-5 6" />
          </>
        )}
      </svg>
    </button>
  );
}
