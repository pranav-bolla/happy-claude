import type { Server, Socket } from "socket.io";
import {
  RADIUS,
  WORLD_H,
  WORLD_W,
  MAX_SPEED,
  MAX_SPIN,
  createBody,
  stepBody,
  speedOf,
  wrapAngle,
  type GrabConstraint,
  type WallHit,
} from "../lib/physics";
import {
  AUTO_REVIVE_MS,
  MAX_HP,
  REVIVE_LOCK_MS,
  wallDamage,
  type Round,
  type UseInput,
  type UsedEvent,
  SNAP_HELD_MS,
  SNAP_IDLE_MS,
  SNAP_MOVING_MS,
  WHIP_MIN_SPEED,
  r1,
  r3,
  type CursorInput,
  type DragInput,
  type FeedItem,
  type FeedKind,
  type GrabRequest,
  type GrabResult,
  type Hype,
  type HypeKind,
  type PlayerIdentity,
  type ReleaseInput,
  type Snapshot,
  type Welcome,
} from "../lib/protocol";
import { ITEMS, isItemId } from "../lib/items";
import { cityFromHeaders, createIdentity } from "./identity";
import type { StatsStore } from "./stats";

interface Player extends PlayerIdentity {
  socket: Socket;
  city: string | null;
  lastDragAt: number;
  lastCursorAt: number;
  /** item id → time it's usable again */
  readyAt: Map<string, number>;
}

interface Held {
  player: Player;
  tx: number;
  ty: number;
  tvx: number;
  tvy: number;
  ox: number;
  oy: number;
  /** wall-clock ms of the last drag packet */
  recvAt: number;
  startedAt: number;
}

const TICK_MS = 1000 / 60;
/** Holder went silent (frozen tab, dead network) → let go. */
const HOLD_SILENCE_MS = 2500;
/** With other people online, nobody gets to hog Claude forever. */
const MAX_CONTESTED_HOLD_MS = 7000;
/** Idle this long → Claude floats back to center. */
const HOME_AFTER_MS = 3500;
/** Max time we extrapolate the holder's pointer past the last packet. */
const TARGET_LEAD_S = 0.06;

function newRound(id: number): Round {
  return {
    id,
    alive: true,
    startedAt: null,
    diedAt: null,
    killMs: null,
    killer: null,
    contributors: [],
    record: false,
  };
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * The single authoritative room. Owns Claude's physics state and the
 * ownership state machine:
 *
 *   FREE ──grab (first valid request wins)──▶ HELD(player)
 *   HELD ──release / disconnect / silence / hog timeout──▶ FREE
 *
 * Node handles socket messages one at a time, so two near-simultaneous grab
 * requests are naturally serialized: whichever packet the server processes
 * first gets ownership, the other gets a rejection naming the holder.
 */
export class World {
  private body = createBody();
  private epoch = 0;
  private held: Held | null = null;
  private homing = false;
  private hp = MAX_HP;
  private round: Round = newRound(1);
  /** who gets credit for damage from a free-flying Claude */
  private lastThrower: Player | null = null;
  private lastActiveAt = Date.now();
  private players = new Map<string, Player>();

  private lastTick = performance.now();
  private lastSnapAt = 0;
  private timer: NodeJS.Timeout | null = null;

  private recentGrabs: { id: string; t: number }[] = [];
  private wallHits: number[] = [];
  private cooldowns = new Map<string, number>();
  private seq = 0;

  constructor(
    private io: Server,
    private stats: StatsStore,
  ) {}

  start(): void {
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── connection lifecycle ──────────────────────────────────────────────

  onConnection(socket: Socket): void {
    const identity = createIdentity(socket.handshake.auth as Record<string, unknown>);
    const player: Player = {
      ...identity,
      socket,
      city: cityFromHeaders(socket.handshake.headers),
      lastDragAt: 0,
      lastCursorAt: 0,
      readyAt: new Map(),
    };
    this.players.set(player.id, player);

    // A (re)connecting client always starts from the authoritative state.
    const welcome: Welcome = {
      you: identity,
      world: this.snapshot(),
      players: this.players.size,
      stats: this.stats.get(),
      round: this.round,
    };
    socket.emit("welcome", welcome);
    this.io.emit("players", this.players.size);

    if (this.players.size > 1 && this.cooldown("join", 6000)) {
      this.feed("join", `${player.name} joined the chaos`, player.color);
    }

    socket.on("grab", (req: GrabRequest, ack: unknown) => {
      const result = this.handleGrab(player, req);
      if (typeof ack === "function") ack(result);
    });
    socket.on("drag", (d: DragInput) => this.handleDrag(player, d));
    socket.on("release", (r: ReleaseInput) => this.handleRelease(player, r));
    socket.on("cursor", (c: CursorInput) => this.handleCursor(player, c));
    socket.on("revive", () => this.revive(player));
    socket.on("use", (u: UseInput) => this.handleUse(player, u));
    socket.on("sync", () => {
      socket.emit("world", this.snapshot());
      socket.emit("round", this.round);
    });
    socket.on("clock", (_t: unknown, ack: unknown) => {
      if (typeof ack === "function") ack(Date.now());
    });
    socket.on("disconnect", () => {
      if (this.held?.player === player) this.forceRelease("disconnect");
      if (this.lastThrower === player) this.lastThrower = null;
      this.players.delete(player.id);
      this.io.emit("players", this.players.size);
      this.io.emit("left", player.id);
    });
  }

  // ── input handlers ────────────────────────────────────────────────────

  private handleGrab(player: Player, req: GrabRequest): GrabResult {
    if (
      !req ||
      ![req.x, req.y, req.ox, req.oy, req.rx, req.ry, req.px, req.py].every(isNum)
    ) {
      return { ok: false };
    }
    if (!this.round.alive) return { ok: false };
    if (this.held) {
      if (this.held.player === player) return { ok: true, epoch: this.epoch };
      return { ok: false, holder: this.identity(this.held.player) };
    }

    // Validate the press against the authoritative position. The client sees
    // Claude slightly in the past, so we allow some slack proportional to his
    // speed. rx/ry is the client's on-screen radius in world units per axis
    // (viewports with odd aspect ratios stretch the world unevenly).
    const b = this.body;
    const slack = 0.25;
    const rx = clamp(req.rx, RADIUS * 0.5, RADIUS * 4) * 1.25 + Math.abs(b.vx) * slack + 30;
    const ry = clamp(req.ry, RADIUS * 0.5, RADIUS * 4) * 1.25 + Math.abs(b.vy) * slack + 30;
    const nx = (req.px - b.x) / rx;
    const ny = (req.py - b.y) / ry;
    if (nx * nx + ny * ny > 1) return { ok: false };

    let ox = req.ox;
    let oy = req.oy;
    const ol = Math.hypot(ox, oy);
    if (ol > RADIUS * 0.95) {
      ox *= (RADIUS * 0.95) / ol;
      oy *= (RADIUS * 0.95) / ol;
    }

    const now = Date.now();
    this.held = {
      player,
      tx: clamp(req.x, -400, WORLD_W + 400),
      ty: clamp(req.y, -400, WORLD_H + 400),
      tvx: 0,
      tvy: 0,
      ox,
      oy,
      recvAt: now,
      startedAt: now,
    };
    this.epoch += 1;
    this.homing = false;
    this.lastActiveAt = now;

    if (this.round.startedAt === null) {
      this.round = { ...this.round, startedAt: now };
      this.io.emit("round", this.round);
    }
    this.trackGrab(player, now);
    this.io.emit("grabbed", { who: this.identity(player), world: this.snapshot() });
    this.lastSnapAt = now;
    return { ok: true, epoch: this.epoch };
  }

  private handleDrag(player: Player, d: DragInput): void {
    const held = this.held;
    if (!held || held.player !== player) return;
    if (!d || ![d.x, d.y, d.vx, d.vy].every(isNum)) return;
    const now = Date.now();
    if (now - player.lastDragAt < 10) return; // rate limit
    player.lastDragAt = now;

    const vmax = MAX_SPEED * 1.5;
    held.tx = clamp(d.x, -400, WORLD_W + 400);
    held.ty = clamp(d.y, -400, WORLD_H + 400);
    held.tvx = clamp(d.vx, -vmax, vmax);
    held.tvy = clamp(d.vy, -vmax, vmax);
    held.recvAt = now;
  }

  private handleRelease(player: Player, r: ReleaseInput): void {
    if (!this.held || this.held.player !== player) return;
    if (!r || ![r.vx, r.vy, r.av].every(isNum)) {
      this.forceRelease("timeout");
      return;
    }
    const b = this.body;

    // Trust the holder's local body pose if it's plausibly close to ours —
    // it's what *they* saw at the instant they let go, so their throw lands
    // exactly as it felt. Far-off poses are ignored.
    if ([r.bx, r.by, r.ba].every(isNum) && Math.hypot(r.bx - b.x, r.by - b.y) < 260) {
      b.x = clamp(r.bx, RADIUS, WORLD_W - RADIUS);
      b.y = clamp(r.by, RADIUS, WORLD_H - RADIUS);
      b.a = wrapAngle(r.ba);
    }
    b.vx = r.vx;
    b.vy = r.vy;
    const s = Math.hypot(b.vx, b.vy);
    if (s > MAX_SPEED) {
      b.vx *= MAX_SPEED / s;
      b.vy *= MAX_SPEED / s;
    }
    b.av = clamp(r.av, -MAX_SPIN, MAX_SPIN);

    this.held = null;
    this.epoch += 1;
    this.lastThrower = player;

    // Fast-forward from the client's release moment to "now" so the server
    // state lines up with what the thrower is already seeing.
    const lead = isNum(r.t) ? clamp((Date.now() - r.t) / 1000, 0, 0.25) : 0;
    if (lead > 0) stepBody(b, lead, { onWall: (h) => this.onWall(h) });

    const speed = speedOf(b);
    this.io.emit("released", { who: this.identity(player), speed, world: this.snapshot() });
    this.lastSnapAt = Date.now();
    this.lastActiveAt = Date.now();
    this.scoreWhip(player, speed);
  }

  private handleCursor(player: Player, c: CursorInput): void {
    if (!c || !isNum(c.x) || !isNum(c.y)) return;
    const now = Date.now();
    if (now - player.lastCursorAt < 40) return;
    player.lastCursorAt = now;
    player.socket.broadcast.volatile.emit("cursor", {
      ...this.identity(player),
      x: r1(clamp(c.x, -200, WORLD_W + 200)),
      y: r1(clamp(c.y, -200, WORLD_H + 200)),
    });
  }

  // ── items ─────────────────────────────────────────────────────────────
  //
  // Clients only say "I used X at my pointer". The server checks cooldown
  // and reach, applies the impulse + damage, and broadcasts the event with
  // the resulting world so every screen plays the same hit. Any hit knocks
  // Claude out of whoever is holding him.

  private handleUse(player: Player, u: UseInput): void {
    if (!u || !isItemId(u.item) || u.item === "hand" || !isNum(u.x) || !isNum(u.y)) return;
    if (!this.round.alive) return;
    const def = ITEMS[u.item];
    const now = Date.now();
    if ((player.readyAt.get(def.id) ?? 0) > now + 80) return; // small slack for clock jitter
    const b = this.body;
    // Generous reach: clients see Claude slightly in the past and viewports
    // stretch the world unevenly.
    const reach = def.reach * RADIUS * 2.2 + speedOf(b) * 0.25;
    if (Math.hypot(u.x - b.x, u.y - b.y) > reach) return;
    player.readyAt.set(def.id, now + def.cooldownMs);

    if (this.round.startedAt === null) {
      this.round = { ...this.round, startedAt: now };
      this.io.emit("round", this.round);
    }
    this.knockLoose(player);
    this.lastThrower = player;
    this.lastActiveAt = now;
    this.homing = false;

    if (def.id === "bomb") {
      const roundId = this.round.id;
      this.emitUsed(player, u, "arm", 0, false);
      setTimeout(() => {
        if (!this.round.alive || this.round.id !== roundId) return;
        this.knockLoose(player);
        this.applyItem(def.id, u.x, u.y);
        this.hurt(def.damage, player);
        this.emitUsed(player, u, "boom", def.damage, true);
      }, def.fuseMs);
      return;
    }

    this.applyItem(def.id, u.x, u.y);
    this.hurt(def.damage, player);
    this.emitUsed(player, u, "hit", def.damage, true);
  }

  private applyItem(item: string, px: number, py: number): void {
    const b = this.body;
    let dx = b.x - px;
    let dy = b.y - py;
    const d = Math.hypot(dx, dy);
    if (d < 1) {
      const a = Math.random() * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    } else {
      dx /= d;
      dy /= d;
    }
    const rnd = (k: number) => (Math.random() - 0.5) * k;
    switch (item) {
      case "whip":
        b.vx += dx * 1700;
        b.vy += dy * 1700;
        b.av += (dx * dy >= 0 ? 1 : -1) * 14;
        break;
      case "hammer":
        // straight down into the floor
        b.vx = b.vx * 0.3 + dx * 500;
        b.vy = b.vy * 0.3 + 2800;
        b.av += rnd(16);
        break;
      case "taser": {
        const a = Math.random() * Math.PI * 2;
        b.vx = b.vx * 0.4 + Math.cos(a) * 900;
        b.vy = b.vy * 0.4 + Math.sin(a) * 900;
        b.av += rnd(50);
        break;
      }
      case "bomb":
        b.vx += dx * 4600 + rnd(800);
        b.vy += dy * 4600 + rnd(800);
        b.av += rnd(40);
        break;
    }
    const s = Math.hypot(b.vx, b.vy);
    if (s > MAX_SPEED) {
      b.vx *= MAX_SPEED / s;
      b.vy *= MAX_SPEED / s;
    }
    b.av = clamp(b.av, -MAX_SPIN, MAX_SPIN);
    this.epoch += 1;
  }

  private emitUsed(player: Player, u: UseInput, phase: UsedEvent["phase"], damage: number, withWorld: boolean): void {
    const ev: UsedEvent = {
      id: ++this.seq,
      item: u.item,
      who: this.identity(player),
      x: r1(u.x),
      y: r1(u.y),
      phase,
      damage,
      world: withWorld ? this.snapshot() : null,
    };
    this.io.emit("used", ev);
    if (withWorld) this.lastSnapAt = Date.now();
  }

  private knockLoose(attacker: Player): void {
    const held = this.held;
    if (!held) return;
    if (held.player !== attacker) {
      this.feed("knock", `${attacker.name} knocked Claude out of ${held.player.name}'s hands`, attacker.color);
    }
    this.forceRelease("timeout");
  }

  /** Release without a throw (disconnect, frozen tab, or hogging). */
  private forceRelease(reason: "disconnect" | "timeout" | "slip"): void {
    const held = this.held;
    if (!held) return;
    this.held = null;
    this.epoch += 1;

    if (reason === "slip") {
      // A little chaotic kick so the slip is visible.
      const ang = Math.random() * Math.PI * 2;
      this.body.vx += Math.cos(ang) * 700;
      this.body.vy += Math.sin(ang) * 700;
      this.body.av += (Math.random() - 0.5) * 16;
      this.feed("slip", `Claude slipped out of ${held.player.name}'s hands`, held.player.color);
    }

    this.io.emit("released", {
      who: this.identity(held.player),
      speed: speedOf(this.body),
      world: this.snapshot(),
      forced: true,
    });
    this.lastSnapAt = Date.now();
    this.lastActiveAt = Date.now();
  }

  // ── simulation loop ───────────────────────────────────────────────────

  private tick(): void {
    const nowPerf = performance.now();
    const dt = Math.min((nowPerf - this.lastTick) / 1000, 0.1);
    this.lastTick = nowPerf;
    const now = Date.now();

    const held = this.held;
    if (held) {
      if (now - held.recvAt > HOLD_SILENCE_MS) this.forceRelease("timeout");
      else if (this.players.size > 1 && now - held.startedAt > MAX_CONTESTED_HOLD_MS) {
        this.forceRelease("slip");
      }
    }

    stepBody(this.body, dt, {
      grab: this.constraint(now),
      homing: this.homing,
      onWall: (h) => this.onWall(h),
    });

    if (!this.round.alive && this.round.diedAt && now - this.round.diedAt > AUTO_REVIVE_MS) {
      this.revive(null);
    }

    const b = this.body;
    const moving = speedOf(b) > 3 || Math.abs(b.av) > 0.03;
    if (this.held || speedOf(b) > 60) this.lastActiveAt = now;

    if (this.round.alive && !this.held && !this.homing && now - this.lastActiveAt > HOME_AFTER_MS) {
      const off = Math.hypot(b.x - WORLD_W / 2, b.y - WORLD_H / 2);
      if (off > 4 || Math.abs(b.a) > 0.03) this.homing = true;
    }
    if (this.homing && !moving && Math.hypot(b.x - WORLD_W / 2, b.y - WORLD_H / 2) < 1) {
      this.homing = false;
    }

    const interval = this.held ? SNAP_HELD_MS : moving || this.homing ? SNAP_MOVING_MS : SNAP_IDLE_MS;
    if (now - this.lastSnapAt >= interval) {
      this.lastSnapAt = now;
      // volatile: if a client's buffer is backed up, drop stale snapshots
      // rather than queueing them — a newer one is always coming.
      this.io.volatile.emit("s", this.snapshot());
    }
  }

  private constraint(now: number): GrabConstraint | null {
    const h = this.held;
    if (!h) return null;
    const age = (now - h.recvAt) / 1000;
    const lead = Math.min(age, TARGET_LEAD_S);
    const live = age < TARGET_LEAD_S;
    return {
      tx: h.tx + h.tvx * lead,
      ty: h.ty + h.tvy * lead,
      tvx: live ? h.tvx : 0,
      tvy: live ? h.tvy : 0,
      ox: h.ox,
      oy: h.oy,
    };
  }

  private snapshot(): Snapshot {
    const b = this.body;
    const c = this.constraint(Date.now());
    return {
      t: Date.now(),
      e: this.epoch,
      x: r1(b.x),
      y: r1(b.y),
      vx: r1(b.vx),
      vy: r1(b.vy),
      a: r3(b.a),
      av: r3(b.av),
      h: this.homing ? 1 : 0,
      d: r3(1 - this.hp / MAX_HP),
      g:
        this.held && c
          ? {
              ...this.identity(this.held.player),
              tx: r1(c.tx),
              ty: r1(c.ty),
              tvx: r1(c.tvx),
              tvy: r1(c.tvy),
              ox: r1(c.ox),
              oy: r1(c.oy),
            }
          : null,
    };
  }

  // ── viral events ──────────────────────────────────────────────────────

  private onWall(hit: WallHit): void {
    const dmg = wallDamage(hit.speed);
    if (dmg > 0) this.hurt(dmg, this.held?.player ?? this.lastThrower);
    if (this.held || hit.speed < 450) return;
    const now = Date.now();
    this.wallHits.push(now);
    this.wallHits = this.wallHits.filter((t) => now - t < 1600);
    if (this.wallHits.length >= 4 && this.cooldown("pinball", 15000)) {
      this.wallHits = [];
      this.hype("pinball", "PINBALL MODE");
    }
  }

  // ── health / rounds ───────────────────────────────────────────────────
  //
  //   ALIVE ──hp hits 0──▶ DEAD ──revive (anyone, after a beat) or auto──▶ ALIVE
  //
  // The kill clock runs from revive to death. The fastest kill is the
  // site-wide "time to beat", credited to whoever landed the final blow.

  private hurt(amount: number, attacker: Player | null): void {
    if (!this.round.alive || amount <= 0) return;
    const before = this.hp;
    this.hp = Math.max(0, this.hp - amount);
    if (attacker && !this.round.contributors.includes(attacker.id)) {
      this.round.contributors.push(attacker.id);
    }
    if (before > MAX_HP / 2 && this.hp <= MAX_HP / 2 && this.cooldown("hurt", 15000)) {
      this.feed("hurt", "Claude is not doing so well");
    }
    if (this.hp <= 0) this.die(attacker);
  }

  private die(killer: Player | null): void {
    const now = Date.now();
    const killMs = now - (this.round.startedAt ?? now);
    const killerId = killer ? this.identity(killer) : null;
    const record = this.stats.recordKill(killMs, killerId);
    this.round = {
      ...this.round,
      alive: false,
      diedAt: now,
      killMs,
      killer: killerId,
      record,
    };
    if (this.held) this.forceRelease("timeout");
    this.homing = false;
    this.io.emit("round", this.round);
    this.io.emit("stats", this.stats.get());
  }

  private revive(by: Player | null): void {
    const r = this.round;
    if (r.alive || !r.diedAt || Date.now() - r.diedAt < REVIVE_LOCK_MS) return;
    this.hp = MAX_HP;
    this.lastThrower = null;
    this.round = newRound(r.id + 1);
    Object.assign(this.body, createBody());
    this.epoch += 1;
    this.lastActiveAt = Date.now();
    this.io.emit("round", this.round);
    this.io.emit("world", this.snapshot());
    this.lastSnapAt = Date.now();
    if (by) this.feed("revive", `${by.name} revived Claude. again.`, by.color);
  }

  private trackGrab(player: Player, now: number): void {
    this.recentGrabs.push({ id: player.id, t: now });
    this.recentGrabs = this.recentGrabs.filter((g) => now - g.t < 15000);

    const last5 = new Set(this.recentGrabs.filter((g) => now - g.t < 5000).map((g) => g.id));
    if (last5.size >= 3 && this.cooldown("jumped", 20000)) {
      this.hype("jumped", "CLAUDE IS GETTING JUMPED");
    }

    const last15 = new Set(this.recentGrabs.map((g) => g.id));
    if (this.players.size >= 3 && last15.size >= 2 && this.cooldown("crowd", 30000)) {
      this.feed("crowd", `${this.players.size} people are fighting over Claude`);
    }
  }

  private scoreWhip(player: Player, speed: number): void {
    if (speed < WHIP_MIN_SPEED) return;
    const record = this.stats.recordWhip(speed);
    this.io.emit("stats", this.stats.get());

    if (speed >= 3600 && this.cooldown("launched", 12000)) {
      this.hype("launched", "ABSOLUTELY LAUNCHED");
    } else if (record && speed > 2200 && this.cooldown("record", 20000)) {
      this.hype("record", `NEW TOP SPEED · ${fmt(speed)} PX/S`);
    }

    if (speed >= 2000 && this.cooldown("speed", 9000)) {
      this.feed("speed", `Claude just hit ${fmt(Math.floor(speed / 100) * 100)} px/s`);
    } else if (speed >= 1300 && this.cooldown("fly", 3500)) {
      const who = player.city && Math.random() < 0.6 ? `someone in ${player.city}` : player.name;
      this.feed("fly", `${who} sent Claude flying`, player.color);
    }
  }

  private feed(kind: FeedKind, text: string, color?: string): void {
    // global throttle so the feed never turns into a wall of text
    if (kind !== "slip" && !this.cooldown("feed", 1500)) return;
    const item: FeedItem = { id: ++this.seq, kind, text, color };
    this.io.emit("feed", item);
  }

  private hype(kind: HypeKind, text: string): void {
    const h: Hype = { id: ++this.seq, kind, text };
    this.io.emit("hype", h);
  }

  private cooldown(key: string, ms: number): boolean {
    const now = Date.now();
    const until = this.cooldowns.get(key) ?? 0;
    if (now < until) return false;
    this.cooldowns.set(key, now + ms);
    return true;
  }

  private identity(p: Player): PlayerIdentity {
    return { id: p.id, name: p.name, color: p.color };
  }
}
