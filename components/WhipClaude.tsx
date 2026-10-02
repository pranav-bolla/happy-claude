"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ClaudeMascot from "./ClaudeMascot";
import { Feed, Header, Hint, HypeText, SoundToggle, StatsBar, StatusPill } from "./Hud";
import { Inventory, type Cooldowns } from "./Inventory";
import { DeathScreen, HealthBar } from "./Round";
import type { ItemId } from "@/lib/items";
import { Engine, type Expression } from "@/lib/client/engine";
import type { ConnStatus } from "@/lib/client/net";
import { MAX_HP, type FeedItem, type Hype, type Round, type Stats } from "@/lib/protocol";

const FEED_TTL_MS = 4200;
const HYPE_TTL_MS = 1500;
const BEST_KEY = "whip-claude:best-kill";

const EMPTY_STATS: Stats = { whips: 0, topSpeed: 0, kills: 0, bestKillMs: null, bestKiller: null };

function loadBest(): number | null {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export default function WhipClaude() {
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
  const bestKill = useRef<number | null>(null);
  const seenDeath = useRef(0);

  const [expression, setExpression] = useState<Expression>("idle");
  const [damage, setDamage] = useState(0);
  const [hp, setHp] = useState(MAX_HP);
  const [round, setRound] = useState<Round | null>(null);
  const [myBest, setMyBest] = useState<number | null>(null);
  const [helped, setHelped] = useState(false);
  const [personalBest, setPersonalBest] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [players, setPlayers] = useState(1);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [recordKey, setRecordKey] = useState(0);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [hype, setHype] = useState<Hype | null>(null);
  const [hint, setHint] = useState(true);
  const [sound, setSound] = useState(false);
  const [item, setItem] = useState<ItemId>("hand");
  const [cooldowns, setCooldowns] = useState<Cooldowns>({});

  useEffect(() => {
    setMyBest(loadBest());

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
        onStatus: setStatus,
        onPlayers: setPlayers,
        onStats: (s) => {
          const prev = bestKill.current;
          if (prev !== null && s.bestKillMs !== null && s.bestKillMs < prev) setRecordKey((k) => k + 1);
          bestKill.current = s.bestKillMs;
          setStats(s);
        },
        onFeed: (item) => {
          setFeed((f) => [...f, item].slice(-3));
          setTimeout(() => setFeed((f) => f.filter((x) => x.id !== item.id)), FEED_TTL_MS);
        },
        onHype: (h) => {
          setHype(h);
          setTimeout(() => setHype((cur) => (cur?.id === h.id ? null : cur)), HYPE_TTL_MS);
        },
        onFirstGrab: () => setHint(false),
        onItem: setItem,
        onCooldown: (id, ms) => setCooldowns((c) => ({ ...c, [id]: { at: performance.now(), ms } })),
        onDamage: setDamage,
        onHp: setHp,
        onRound: (r, myId) => {
          setRound(r);
          if (r.alive || r.killMs === null || seenDeath.current === r.id) return;
          seenDeath.current = r.id;
          // Your personal best counts any kill you dealt damage in.
          const didHelp = !!myId && r.contributors.includes(myId);
          setHelped(didHelp);
          setPersonalBest(false);
          if (!didHelp) return;
          const best = loadBest();
          if (best === null || r.killMs < best) {
            try {
              localStorage.setItem(BEST_KEY, String(r.killMs));
            } catch {
              /* private mode */
            }
            setMyBest(r.killMs);
            setPersonalBest(true);
          }
        },
      },
    );
    engine.current = e;
    e.start();
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, []);

  const toggleSound = useCallback(() => {
    setSound((on) => {
      engine.current?.sound.setEnabled(!on);
      return !on;
    });
  }, []);

  const now = useCallback(() => engine.current?.serverNow() ?? Date.now(), []);
  const revive = useCallback(() => engine.current?.revive(), []);
  const selectItem = useCallback((id: ItemId) => engine.current?.setItem(id), []);

  return (
    <main className="fixed inset-0 touch-none overflow-hidden bg-cream select-none">
      <div className="bg-glow pointer-events-none absolute inset-0" />
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

      <Hint visible={hint} />
      <HypeText hype={hype} />
      <Header />
      <HealthBar hp={hp} round={round} now={now} />
      <StatusPill status={status} players={players} />
      <Feed items={feed} />
      <StatsBar stats={stats} recordKey={recordKey} myBest={myBest} />
      <SoundToggle on={sound} onToggle={toggleSound} />
      <Inventory selected={item} cooldowns={cooldowns} onSelect={selectItem} />
      <DeathScreen
        round={round}
        stats={stats}
        myBest={myBest}
        personalBest={personalBest}
        helped={helped}
        now={now}
        onRevive={revive}
      />
    </main>
  );
}
