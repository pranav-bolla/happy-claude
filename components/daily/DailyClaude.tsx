"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ClaudeMascot from "../ClaudeMascot";
import { SoundToggle } from "../Hud";
import { Inventory } from "../Inventory";
import { Engine, type Expression } from "@/lib/client/engine";
import { getResult, getStats, hasSeenRules, markRulesSeen, saveResult, type DailyStats } from "@/lib/client/dailyStore";
import { ITEMS, ITEM_ORDER, type ItemId } from "@/lib/items";
import { ITEM_ART } from "@/lib/client/itemArt";
import { dailySpec, dayNumber, moveColor, type DailyResult, type DailySpec, type SharedRun } from "@/lib/daily";
import { DailyResults, RunGrid, type GlobalDaily } from "./DailyResults";

type Phase = "intro" | "playing" | "done";

const noop = () => {};

/** `challenge` is the run from a shared link (?r=...), if any. */
export default function DailyClaude({ challenge }: { challenge?: SharedRun | null }) {
  const [day, setDay] = useState<number | null>(null);
  useEffect(() => setDay(dayNumber()), []);
  if (day === null) return <main className="fixed inset-0 bg-cream" />;
  return <DailyGame key={day} day={day} challenge={challenge?.day === day ? challenge : null} />;
}

function DailyGame({ day, challenge }: { day: number; challenge: SharedRun | null }) {
  const [spec] = useState<DailySpec>(() => dailySpec(day));
  const loadoutItems: ItemId[] = ["hand", ...ITEM_ORDER.filter((id) => spec.loadout[id])];

  const stage = useRef<HTMLDivElement>(null);
  const claude = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const stretch = useRef<HTMLDivElement>(null);
  const jelly = useRef<HTMLDivElement>(null);
  const spin = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const hurt = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);

  const [phase, setPhase] = useState<Phase>(() => (getResult(day) ? "done" : "intro"));
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [showRules, setShowRules] = useState(false);
  const [expression, setExpression] = useState<Expression>("idle");
  const [damage, setDamage] = useState(0);
  const [hp, setHp] = useState(spec.hp);
  const [item, setItem] = useState<ItemId>("hand");
  const [grid, setGrid] = useState<number[]>([]);
  const [counts, setCounts] = useState<Partial<Record<ItemId, number>>>({ ...spec.loadout });
  const [result, setResult] = useState<DailyResult | null>(() => getResult(day));
  const [stats, setStats] = useState<DailyStats>(() => getStats(day));
  const [global, setGlobal] = useState<GlobalDaily | null>(null);
  const [sound, setSound] = useState(false);
  const [killed, setKilled] = useState(false);

  const game = useRef({
    moves: 0,
    grid: [] as number[],
    actions: [] as ItemId[],
    counts: { ...spec.loadout } as Partial<Record<ItemId, number>>,
    startedAt: 0,
    hp: spec.hp,
    over: false,
  });

  useEffect(() => {
    if (!hasSeenRules()) setShowRules(true);
  }, []);

  const finish = useCallback(
    (didKill: boolean) => {
      const g = game.current;
      if (g.over) return;
      g.over = true;
      const r: DailyResult = {
        day,
        killed: didKill,
        moves: g.moves,
        maxMoves: spec.moves,
        ms: didKill ? Math.round(performance.now() - g.startedAt) : 0,
        hpLeft: Math.max(0, Math.round(g.hp)),
        grid: g.grid.map((d) => Math.round(d)),
        actions: [...g.actions],
        modifier: spec.modifier.name,
      };
      saveResult(r);
      setResult(r);
      setStats(getStats(day));
      void fetch("/api/daily", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ day, killed: didKill, moves: r.moves }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((s) => s && setGlobal(s))
        .catch(noop);
      setTimeout(() => setPhase("done"), didKill ? 1700 : 900);
    },
    [day, spec],
  );

  // already played today: just fetch how everyone else is doing
  useEffect(() => {
    if (!getResult(day)) return;
    void fetch(`/api/daily?day=${day}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((s) => s && setGlobal(s))
      .catch(noop);
  }, [day]);

  useEffect(() => {
    const narrow = () => window.innerWidth < 640;
    const e = new Engine(
      {
        stage: stage.current!,
        claude: claude.current!,
        shadow: shadow.current!,
        stretch: stretch.current!,
        jelly: jelly.current!,
        spin: spin.current!,
        canvas: canvas.current!,
        overlay: overlay.current!,
        tag: tag.current!,
        bubble: bubble.current!,
        hurt: hurt.current!,
      },
      {
        onExpression: setExpression,
        onStatus: noop,
        onPlayers: noop,
        onStats: noop,
        onFeed: noop,
        onHype: noop,
        onFirstGrab: noop,
        onDamage: setDamage,
        onHp: setHp,
        onRound: noop,
        onItem: setItem,
        onCooldown: noop,
        onChat: noop,
        onChatHistory: noop,
      },
      {
        arena: spec.arena,
        start: spec.start,
        pegs: spec.pegs,
        spikes: spec.spikes,
        tune: spec.modifier.tune,
        wallMul: spec.modifier.wallMul,
        maxHp: spec.hp,
        insets: () => ({ top: narrow() ? 150 : 128, bottom: narrow() ? 96 : 112, side: narrow() ? 10 : 32 }),
        act: (action) => {
          const g = game.current;
          if (g.over || phaseRef.current !== "playing") return "";
          if (g.moves >= spec.moves) return "out of moves";
          if (action !== "hand") {
            const left = g.counts[action] ?? 0;
            if (left <= 0) return `no ${ITEMS[action].name} left`;
            g.counts[action] = left - 1;
            setCounts({ ...g.counts });
          }
          if (g.moves === 0) g.startedAt = performance.now();
          g.grid.push(0);
          g.actions.push(action);
          g.moves++;
          setGrid([...g.grid]);
          return g.moves - 1;
        },
        onDamage: (move, amount, hpLeft) => {
          const g = game.current;
          if (move >= 0 && move < g.grid.length) g.grid[move] += amount;
          g.hp = hpLeft;
          setGrid([...g.grid]);
        },
        onKill: () => {
          setKilled(true);
          finish(true);
        },
      },
    );
    engine.current = e;
    e.start();
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, [spec, finish]);

  // Out of moves: wait for him to stop moving (and any bomb to go off), then call it.
  const outOfMoves = phase === "playing" && grid.length >= spec.moves && !killed;
  useEffect(() => {
    if (!outOfMoves) return;
    let calm = 0;
    const id = setInterval(() => {
      if (game.current.over) return clearInterval(id);
      calm = engine.current?.settled() ? calm + 1 : 0;
      if (calm >= 3) {
        clearInterval(id);
        finish(false);
      }
    }, 250);
    return () => clearInterval(id);
  }, [outOfMoves, finish]);

  const toggleSound = useCallback(() => {
    setSound((on) => {
      engine.current?.sound.setEnabled(!on);
      return !on;
    });
  }, []);

  const start = () => setPhase("playing");

  const selectItem = useCallback((id: ItemId) => engine.current?.setItem(id), []);
  const movesLeft = spec.moves - grid.length;

  return (
    <main className="fixed inset-0 touch-none overflow-hidden bg-cream select-none">
      <div className="bg-dots pointer-events-none absolute inset-0" />

      <div ref={stage} className="absolute inset-0 touch-none">
        <canvas ref={canvas} className="pointer-events-none absolute left-0 top-0" />
        <div ref={claude} className="claude-root">
          <div ref={shadow} className="claude-shadow" />
          <div ref={stretch} className="claude-layer">
            <div ref={jelly} className="claude-layer">
              <div className="claude-layer claude-enter">
                <div ref={spin} className="claude-layer">
                  <ClaudeMascot expression={expression} damage={damage} />
                </div>
              </div>
            </div>
          </div>
        </div>
        <div ref={overlay} className="pointer-events-none absolute inset-0">
          <div ref={tag} className="grab-tag">
            <div className="grab-tag-inner">
              <span data-text />
            </div>
          </div>
          <div ref={bubble} className="speech">
            <div className="speech-inner">
              <span data-text />
            </div>
          </div>
        </div>
      </div>

      <div ref={hurt} className="hurt-vignette" />

      {/* ── top HUD ── */}
      <div className="pointer-events-none absolute inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] flex flex-col items-center gap-1.5 px-3 sm:top-4">
        <div className="pointer-events-auto flex w-full max-w-[560px] items-center justify-between gap-2">
          <Link href="/" className="font-mono text-[10px] font-bold tracking-[0.14em] text-muted hover:text-ink">
            ← THE MOB
          </Link>
          <h1 className="font-mono text-[13px] font-black tracking-[0.2em] text-ink sm:text-sm">DAILY CLAUDE #{day}</h1>
          <button
            type="button"
            onClick={() => setShowRules(true)}
            className="font-mono text-[10px] font-bold tracking-[0.14em] text-muted hover:text-ink"
          >
            HOW TO ?
          </button>
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.12em]">
          <span className="bg-ink px-1.5 py-0.5 font-bold text-cream">{spec.modifier.name.toUpperCase()}</span>
          <span className="text-muted">{spec.modifier.blurb}</span>
        </div>

        <div className="w-[min(92vw,360px)]">
          <div className="mb-1 flex justify-between font-mono text-[10px] font-bold tracking-[0.14em] text-ink">
            <span>{hp} HP</span>
            <span className={movesLeft <= 2 && phase === "playing" ? "text-red-600" : "text-muted"}>
              {movesLeft} MOVE{movesLeft === 1 ? "" : "S"} LEFT
            </span>
          </div>
          <div className="h-2.5 w-full bg-black/10">
            <motion.div
              className="h-full"
              animate={{ width: `${(hp / spec.hp) * 100}%` }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              style={{ background: hp / spec.hp > 0.5 ? "#22C55E" : hp / spec.hp > 0.25 ? "#F59E0B" : "#EF4444" }}
            />
          </div>
          <div className="mt-1.5 flex gap-1">
            {Array.from({ length: spec.moves }, (_, i) => {
              const used = i < grid.length;
              const isKill = killed && i === grid.length - 1;
              return (
                <div
                  key={i}
                  className={`flex h-4 flex-1 items-center justify-center text-[9px] ${used ? "" : "border border-black/15"} ${used && i === grid.length - 1 && !game.current.over ? "animate-pulse" : ""}`}
                  style={used ? { background: isKill ? "#1D1D1F" : moveColor(grid[i]) } : undefined}
                >
                  {isKill ? "💀" : ""}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {phase === "playing" && (
        <Inventory
          selected={item}
          cooldowns={{}}
          onSelect={selectItem}
          items={loadoutItems}
          counts={counts}
        />
      )}
      <SoundToggle on={sound} onToggle={toggleSound} />

      {/* ── intro ── */}
      <AnimatePresence>
        {phase === "intro" && !showRules && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center bg-cream/60 px-4 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ y: 20, scale: 0.95 }}
              animate={{ y: 0, scale: 1 }}
              className="w-full max-w-[340px] bg-ink p-5 text-cream shadow-[8px_8px_0_rgba(217,119,87,0.9)]"
            >
              <p className="font-mono text-[11px] font-bold tracking-[0.24em] text-claude">DAILY CLAUDE #{day}</p>
              <p className="mt-2 text-[28px] font-black leading-none tracking-tight">{spec.modifier.name}</p>
              <p className="mt-1 font-mono text-[11px] text-white/60">{spec.modifier.blurb}</p>

              <div className="mt-4 grid grid-cols-3 gap-2 font-mono">
                <Stat label="HP" value={spec.hp} />
                <Stat label="MOVES" value={spec.moves} />
                <Stat label="SPIKES" value={spec.spikes.join(" + ")} small />
              </div>

              <p className="mt-4 font-mono text-[10px] tracking-[0.16em] text-white/50">TODAY&apos;S LOADOUT</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {loadoutItems.map((id) => (
                  <div key={id} className="flex items-center gap-1.5 bg-white/10 px-2 py-1 font-mono text-[11px]">
                    <span className="h-4 w-4 [image-rendering:pixelated]" dangerouslySetInnerHTML={{ __html: ITEM_ART[id] }} />
                    {id === "hand" ? "∞" : `×${spec.loadout[id]}`}
                  </div>
                ))}
              </div>

              {challenge && (
                <div className="mt-4 border border-claude/60 bg-claude/10 p-2.5">
                  <p className="font-mono text-[11px] font-bold tracking-[0.12em] text-claude">
                    {challenge.killed ? `🎯 BEAT ${challenge.grid.length}/${spec.moves}` : "🎯 THEY COULDN'T KO HIM"}
                  </p>
                  <div className="mt-2">
                    <RunGrid actions={challenge.actions} grid={challenge.grid} killed={challenge.killed} size={18} />
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={start}
                className="mt-5 w-full bg-claude py-3 font-mono text-[13px] font-bold tracking-[0.16em] text-ink transition-transform hover:brightness-110 active:scale-[0.97]"
              >
                START
              </button>
              <p className="mt-2 text-center font-mono text-[10px] text-white/40">one try. same Claude for everyone today.</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── rules ── */}
      <AnimatePresence>
        {showRules && (
          <motion.div
            className="absolute inset-0 z-10 flex items-center justify-center bg-ink/40 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => (markRulesSeen(), setShowRules(false))}
          >
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[360px] bg-cream p-5 text-ink shadow-[8px_8px_0_#1D1D1F]"
            >
              <p className="font-mono text-[11px] font-bold tracking-[0.24em] text-claude">HOW TO PLAY</p>
              <p className="mt-2 text-[22px] font-black leading-tight">Kill Claude in as few moves as you can.</p>
              <ul className="mt-3 space-y-1.5 text-[13px] leading-snug text-ink/80">
                <li>• Every <b>grab</b> or <b>item use</b> costs 1 move.</li>
                <li>• Throw him into walls and bumpers. <b className="text-red-700">Spiked</b> walls hurt double.</li>
                <li>• Dragging him into a wall does nothing. You have to let go.</li>
                <li>• Run out of moves and he survives.</li>
                <li>• Same Claude for everyone. New one every midnight.</li>
              </ul>
              <div className="mt-3 flex items-center gap-1.5 font-mono text-[10px] text-muted">
                each move →
                {[0, 8, 20, 40].map((d) => (
                  <span key={d} className="h-3 w-3" style={{ background: moveColor(d) }} />
                ))}
                by damage, 💀 = killing blow
              </div>
              <button
                type="button"
                onClick={() => (markRulesSeen(), setShowRules(false))}
                className="mt-4 w-full bg-ink py-3 font-mono text-[13px] font-bold tracking-[0.16em] text-cream active:scale-[0.97]"
              >
                GOT IT
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── results ── */}
      <AnimatePresence>
        {phase === "done" && result && (
          <DailyResults result={result} stats={stats} global={global} day={day} challenge={challenge} />
        )}
      </AnimatePresence>
    </main>
  );
}

function Stat({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="bg-white/10 px-2 py-1.5">
      <p className="text-[9px] tracking-[0.16em] text-white/50">{label}</p>
      <p className={`${small ? "text-[11px]" : "text-[18px]"} font-black uppercase leading-tight`}>{value}</p>
    </div>
  );
}
