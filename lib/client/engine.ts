/**
 * Client game engine. Runs outside React: one requestAnimationFrame loop
 * that simulates, renders (by writing CSS transforms directly) and decides
 * when to talk to the network. React only hears about low-frequency things
 * (expression changes, player count, feed items...).
 *
 * ── How Claude stays smooth on every screen ──────────────────────────────
 *
 * Rendering and networking run on separate clocks:
 *   - Every animation frame we step the shared physics (lib/physics.ts)
 *     locally. That's the "prediction".
 *   - Server snapshots arrive at ~20-30 Hz. Each one is fast-forwarded by
 *     (serverNow - snapshot.t) using the same physics, giving our best guess
 *     of where the server's Claude is *right now*.
 *   - We jump the simulation to that guess but keep drawing where Claude
 *     was, via a visual error offset that decays exponentially (~100 ms).
 *     Small disagreements melt away invisibly; big ones (tab was asleep,
 *     reconnect) snap instantly.
 *
 * Holding Claude:
 *   - On press we start dragging *immediately* (optimistic) and ask the
 *     server for ownership. The local sim drives your screen with zero
 *     latency; snapshots are ignored while we're the visual authority.
 *   - The pointer target is sent ~30x/s, not per frame.
 *   - On release we compute the throw from the last ~70 ms of pointer
 *     samples and send it with our local body pose. We keep ignoring
 *     snapshots until one arrives with the post-release epoch.
 *   - If the server rejects the grab (someone else got there first), we
 *     drop the drag and blend back to the authoritative state.
 */

import {
  INERTIA,
  MAX_SPEED,
  MAX_SPIN,
  RADIUS,
  WORLD_H,
  WORLD_W,
  copyBody,
  createBody,
  speedOf,
  stepBody,
  wrapAngle,
  type Body,
  type GrabConstraint,
  type WallHit,
} from "../physics";
import {
  CURSOR_SEND_MS,
  DRAG_SEND_MS,
  MAX_HP,
  wallDamage,
  type ChatMessage,
  type ChatResult,
  type FeedItem,
  type Round,
  type UsedEvent,
  type GrabInfo,
  type GrabbedEvent,
  type Hype,
  type PlayerIdentity,
  type ReleasedEvent,
  type RemoteCursor,
  type Snapshot,
  type Stats,
  type Welcome,
} from "../protocol";
import { Fx } from "./fx";
import { Net, type ConnStatus } from "./net";
import { ITEMS, ITEM_ORDER, type ItemId } from "../items";
import { ITEM_ART } from "./itemArt";
import { BROKEN_LINES, GRAB_LINES, HEAL_LINES, IMPACT_LINES, SCARED_LINES, pick } from "./lines";
import { Sfx } from "./sound";

export type Expression = "idle" | "curious" | "grabbed" | "woozy" | "smashed" | "dead";

export interface EngineDom {
  stage: HTMLDivElement;
  claude: HTMLDivElement;
  shadow: HTMLDivElement;
  stretch: HTMLDivElement;
  jelly: HTMLDivElement;
  spin: HTMLDivElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  tag: HTMLDivElement;
  bubble: HTMLDivElement;
  hurt: HTMLDivElement;
}

export interface EngineEvents {
  onExpression(e: Expression): void;
  onStatus(s: ConnStatus): void;
  onPlayers(n: number): void;
  onStats(s: Stats): void;
  onFeed(f: FeedItem): void;
  onHype(h: Hype): void;
  onFirstGrab(): void;
  /** visible damage tier 0-3, only fired on change */
  onDamage(level: number): void;
  /** current HP 0..MAX_HP, fired when it changes */
  onHp(hp: number): void;
  onRound(r: Round, myId: string | null): void;
  onItem(item: ItemId): void;
  /** an item went on cooldown locally */
  onCooldown(item: ItemId, ms: number): void;
  onChat(m: ChatMessage): void;
  /** full recent history (on join / reconnect) */
  onChatHistory(list: ChatMessage[]): void;
}

/** Throws feel better slightly exaggerated. */
const THROW_BOOST = 1.22;
/** How much an off-center throw spins him. */
const SPIN_KICK = 0.14;
/** Visual error offset decay time constant (seconds). */
const SMOOTH_TAU = 0.1;
/** Remote grab target extrapolation cap (matches server). */
const TARGET_LEAD_S = 0.06;

interface Hold {
  token: number;
  pointerId: number;
  ox: number;
  oy: number;
  shiftX: number;
  shiftY: number;
}

interface Sample {
  t: number;
  x: number;
  y: number;
}

interface CursorView {
  id: string;
  el: HTMLDivElement;
  x: number;
  y: number;
  /** world-space target */
  wx: number;
  wy: number;
  seenAt: number;
  releasedAt: number;
  shown: boolean;
  grabbing: boolean;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

const cursorCache = new Map<ItemId, string>();
function itemCursor(id: ItemId): string {
  let c = cursorCache.get(id);
  if (!c) {
    const svg = ITEM_ART[id].replace('width="100%" height="100%"', 'width="32" height="32"');
    c = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 8 8, crosshair`;
    cursorCache.set(id, c);
  }
  return c;
}

export class Engine {
  readonly sound = new Sfx();
  private net: Net;
  private fx: Fx;

  // viewport mapping (world → screen)
  private W = 0;
  private H = 0;
  private r = 80;
  private sx = 1;
  private sy = 1;

  // simulation
  private sim: Body = createBody();
  private off = { x: 0, y: 0, a: 0 };
  private homing = false;
  private lastEpoch = -1;
  private lastSnapT = 0;
  private remote: (GrabInfo & { t: number }) | null = null;
  private forceSnap = true;

  // local ownership
  private me: PlayerIdentity | null = null;
  private hold: Hold | null = null;
  private holdSeq = 0;
  /** While set, ignore snapshot bodies with epoch < until (null = unknown yet). */
  private authority: { until: number | null; since: number } | null = null;
  private samples: Sample[] = [];

  // pointer
  private pointer = { x: -1, y: -1, active: false, mouse: true };
  private hover = false;
  private cursorStyle = "";

  // juice
  private jelly = { amp: 0, vel: 0, nx: 1, ny: 0 };
  private lift = 1;
  private bobAmp = 0;
  private look = { x: 0, y: 0 };
  private shake = 0;
  private shaking = false;
  private smashedUntil = 0;
  private woozyUntil = 0;
  private lastWallFx = 0;
  private blurred = false;
  private expression: Expression = "idle";
  private reducedMotion = false;
  private item: ItemId = "hand";
  private readyAt = new Map<ItemId, number>();
  private bombs: HTMLDivElement[] = [];
  private lastWallNumber = 0;
  private alive = true;
  private roundId = 0;
  private hp = MAX_HP;
  private serverDamage = 0;
  private damage = 0;
  private damageLevel = 0;
  private flash = 0;
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  private bubbleUntil = 0;
  private lastQuip = 0;
  private lastScared = 0;
  private wasHover = false;

  // network pacing
  private lastDragSent = 0;
  private lastCursorSent = 0;

  // remote presence
  private cursors = new Map<string, CursorView>();
  private tagTimer: ReturnType<typeof setTimeout> | null = null;

  private raf = 0;
  private lastFrame = 0;
  private firstFrame = true;
  private grabbedOnce = false;
  private disposers: (() => void)[] = [];

  constructor(
    private dom: EngineDom,
    private ev: EngineEvents,
  ) {
    this.fx = new Fx(dom.canvas);
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.net = new Net({
      onStatus: (s) => {
        if (s === "disconnected") this.remote = null;
        ev.onStatus(s);
      },
      onWelcome: (w) => this.onWelcome(w),
      onSnapshot: (s) => this.applySnapshot(s),
      onGrabbed: (e) => this.onGrabbed(e),
      onReleased: (e) => this.onReleased(e),
      onPlayers: ev.onPlayers,
      onStats: ev.onStats,
      onFeed: ev.onFeed,
      onHype: (h) => this.onHype(h),
      onCursor: (c) => this.onCursor(c),
      onLeft: (id) => this.removeCursor(id),
      onRound: (r) => this.onRound(r),
      onUsed: (e) => this.onUsed(e),
      onChat: ev.onChat,
    });
  }

  start(): void {
    this.resize();
    const on = <K extends keyof WindowEventMap>(
      target: Window | Document | HTMLElement,
      type: K | string,
      fn: (e: never) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, "resize", () => this.resize());
    on(this.dom.stage, "pointerdown", (e: PointerEvent) => this.onPointerDown(e), { passive: false });
    on(window, "pointermove", (e: PointerEvent) => this.onPointerMove(e), { passive: true });
    on(window, "pointerup", (e: PointerEvent) => this.onPointerUp(e));
    on(window, "pointercancel", (e: PointerEvent) => this.onPointerUp(e));
    on(document.documentElement, "mouseleave", () => (this.pointer.active = false));
    on(window, "blur", () => this.release());
    on(window, "keydown", (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const id = ITEM_ORDER.find((i) => ITEMS[i].key === e.key);
      if (id) this.setItem(id);
    });
    on(document, "visibilitychange", () => this.onVisibility());
    // iOS: stop the page from rubber-banding while dragging
    on(this.dom.stage, "touchmove", (e: TouchEvent) => e.preventDefault(), { passive: false });

    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
    this.net.destroy();
    if (this.tagTimer) clearTimeout(this.tagTimer);
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.cursors.forEach((c) => c.el.remove());
    this.cursors.clear();
    this.bombs.forEach((b) => b.remove());
  }

  // ── viewport mapping ──────────────────────────────────────────────────
  // Claude's *center* range [R, WORLD-R] maps onto [r, screen-r] per axis,
  // so he touches the edge of YOUR screen exactly when the server says he
  // hits the wall, whatever your aspect ratio. Crossing time is identical
  // for everyone; only on-screen px speed differs.

  private resize(): void {
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.r = clamp(Math.min(this.W, this.H) * 0.13, 64, 120);
    this.sx = (this.W - 2 * this.r) / (WORLD_W - 2 * RADIUS);
    this.sy = (this.H - 2 * this.r) / (WORLD_H - 2 * RADIUS);
    const size = `${this.r * 2}px`;
    this.dom.claude.style.width = size;
    this.dom.claude.style.height = size;
    this.fx.resize(this.W, this.H);
  }

  private toScreenX(x: number): number {
    return this.r + (x - RADIUS) * this.sx;
  }
  private toScreenY(y: number): number {
    return this.r + (y - RADIUS) * this.sy;
  }
  private toWorldX(px: number): number {
    return RADIUS + (px - this.r) / this.sx;
  }
  private toWorldY(py: number): number {
    return RADIUS + (py - this.r) / this.sy;
  }

  /** Where Claude is drawn right now (world units). */
  private renderPos(): { x: number; y: number; a: number } {
    return {
      x: clamp(this.sim.x + this.off.x, RADIUS, WORLD_W - RADIUS),
      y: clamp(this.sim.y + this.off.y, RADIUS, WORLD_H - RADIUS),
      a: this.sim.a + this.off.a,
    };
  }

  // ── input ─────────────────────────────────────────────────────────────

  private onPointerDown(e: PointerEvent): void {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    this.updatePointer(e);
    if (this.hold) return;

    if (this.item !== "hand") {
      e.preventDefault();
      this.useItem(e.clientX, e.clientY, e.pointerType !== "mouse");
      return;
    }

    const rp = this.renderPos();
    const cx = this.toScreenX(rp.x);
    const cy = this.toScreenY(rp.y);
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    const speedPx = Math.hypot(this.sim.vx * this.sx, this.sim.vy * this.sy);
    // generous hitbox, even more generous when he's flying
    const hitR = this.r * (e.pointerType === "mouse" ? 1.08 : 1.25) + Math.min(speedPx * 0.035, 45);
    if (dx * dx + dy * dy > hitR * hitR) return;
    e.preventDefault();

    if (!this.grabbedOnce) {
      this.grabbedOnce = true;
      this.ev.onFirstGrab();
    }

    if (!this.alive) {
      this.kickJelly(0, 1, 4);
      this.showTag("he's dead. hit revive.", "#6B6B6B");
      return;
    }
    if (this.remote) {
      this.showTag(`${this.remote.name} has him`, this.remote.color);
      this.kickJelly(0, 1, 5);
      return;
    }
    this.beginHold(e, dx, dy, rp.a);
  }

  private beginHold(e: PointerEvent, dx: number, dy: number, angle: number): void {
    // Grab point: screen offset → isotropic world offset → Claude's local frame.
    const d = Math.hypot(dx, dy);
    const maxD = this.r * 0.92;
    if (d > maxD) {
      dx *= maxD / d;
      dy *= maxD / d;
    }
    const ix = (dx / this.r) * RADIUS;
    const iy = (dy / this.r) * RADIUS;
    const c = Math.cos(-angle);
    const s = Math.sin(-angle);
    const ox = ix * c - iy * s;
    const oy = ix * s + iy * c;

    // Fold the visual offset into the sim so the drag starts exactly where
    // Claude is drawn — no pop on press.
    this.sim.x += this.off.x;
    this.sim.y += this.off.y;
    this.sim.a = wrapAngle(this.sim.a + this.off.a);
    this.off = { x: 0, y: 0, a: 0 };

    const pwx = this.toWorldX(e.clientX);
    const pwy = this.toWorldY(e.clientY);
    const ca = Math.cos(this.sim.a);
    const sa = Math.sin(this.sim.a);
    const attachX = this.sim.x + ox * ca - oy * sa;
    const attachY = this.sim.y + ox * sa + oy * ca;

    const token = ++this.holdSeq;
    this.hold = {
      token,
      pointerId: e.pointerId,
      ox,
      oy,
      shiftX: attachX - pwx,
      shiftY: attachY - pwy,
    };
    this.samples = [{ t: performance.now(), x: pwx, y: pwy }];
    try {
      this.dom.stage.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    this.sound.grab();
    navigator.vibrate?.(8);
    this.kickJelly(0, 1, 6);
    this.fx.ring(e.clientX, e.clientY, this.me?.color ?? "#D97757", 34);

    if (!this.net.connected) return; // offline: purely local toy until we reconnect
    this.authority = { until: null, since: performance.now() };
    this.lastDragSent = performance.now();
    void this.net
      .grab({
        x: attachX,
        y: attachY,
        px: pwx,
        py: pwy,
        ox,
        oy,
        rx: this.r / this.sx,
        ry: this.r / this.sy,
      })
      .then((res) => {
        if (res.ok) {
          if (this.authority && this.holdSeq === token) this.authority.until = res.epoch + 1;
          return;
        }
        // Lost the race (or missed). Drop the drag and blend back.
        if (this.holdSeq === token) {
          if (this.hold?.token === token) this.hold = null;
          this.authority = null;
          if (res.holder) this.showTag(`${res.holder.name} got him first`, res.holder.color);
          this.kickJelly(1, 0, 5);
          this.net.requestSync();
        }
      });
  }

  private onPointerMove(e: PointerEvent): void {
    this.updatePointer(e);
    if (!this.hold || e.pointerId !== this.hold.pointerId) return;
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    const now = performance.now();
    for (const ce of list) {
      this.samples.push({ t: now, x: this.toWorldX(ce.clientX), y: this.toWorldY(ce.clientY) });
    }
    // timestamps of coalesced events are all ~now; spread them across the
    // frame so the velocity estimate isn't skewed
    if (list.length > 1) {
      const n = list.length;
      for (let i = 0; i < n; i++) {
        this.samples[this.samples.length - n + i].t = now - (n - 1 - i) * (16 / n);
      }
    }
    while (this.samples.length > 2 && now - this.samples[0].t > 200) this.samples.shift();
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerType !== "mouse") this.pointer.active = false;
    if (this.hold && e.pointerId === this.hold.pointerId) this.release();
  }

  private updatePointer(e: PointerEvent): void {
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.active = true;
    this.pointer.mouse = e.pointerType === "mouse";
  }

  /** Average pointer velocity (world units/s) over the trailing window. */
  private pointerVelocity(now: number, windowMs: number): { x: number; y: number } {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const last = s[s.length - 1];
    let first = s[s.length - 2];
    for (let i = s.length - 2; i >= 0; i--) {
      first = s[i];
      if (last.t - s[i].t >= windowMs) break;
    }
    const dt = (last.t - first.t) / 1000;
    if (dt < 0.004) return { x: 0, y: 0 };
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    // pointer has been still → the throw dies off
    const still = now - last.t;
    if (still > 35) {
      const k = Math.max(0, 1 - (still - 35) / 70);
      vx *= k;
      vy *= k;
    }
    return { x: vx, y: vy };
  }

  private release(): void {
    const hold = this.hold;
    if (!hold) return;
    this.hold = null;
    const now = performance.now();
    const b = this.sim;

    // Throw = recent pointer velocity (boosted). If the body is already
    // moving faster (a whip from swinging), keep the body's momentum.
    const pv = this.pointerVelocity(now, 70);
    let vx = pv.x * THROW_BOOST;
    let vy = pv.y * THROW_BOOST;
    if (Math.hypot(b.vx, b.vy) > Math.hypot(vx, vy)) {
      vx = b.vx;
      vy = b.vy;
    }
    const s = Math.hypot(vx, vy);
    if (s > MAX_SPEED) {
      vx *= MAX_SPEED / s;
      vy *= MAX_SPEED / s;
    }
    const ca = Math.cos(b.a);
    const sa = Math.sin(b.a);
    const rx = hold.ox * ca - hold.oy * sa;
    const ry = hold.ox * sa + hold.oy * ca;
    const av = clamp(b.av + ((rx * vy - ry * vx) / INERTIA) * SPIN_KICK, -MAX_SPIN, MAX_SPIN);

    b.vx = vx;
    b.vy = vy;
    b.av = av;

    const speed = Math.hypot(vx, vy);
    this.sound.release(speed);
    if (speed > 3200) this.sound.launch();

    if (this.authority) {
      this.authority.since = now;
      this.net.release({
        vx,
        vy,
        av,
        bx: b.x,
        by: b.y,
        ba: b.a,
        t: this.net.serverNow(),
      });
    }
  }

  // ── network events ────────────────────────────────────────────────────

  private onWelcome(w: Welcome): void {
    this.me = w.you;
    this.hold = null;
    this.authority = null;
    this.lastEpoch = -1;
    this.lastSnapT = 0;
    this.forceSnap = true;
    this.ev.onPlayers(w.players);
    this.ev.onStats(w.stats);
    this.alive = w.round.alive;
    this.roundId = w.round.id;
    this.ev.onRound(w.round, w.you.id);
    this.ev.onChatHistory(w.chat ?? []);
    this.applySnapshot(w.world);
  }

  revive(): void {
    this.net.revive();
  }

  chat(text: string): Promise<ChatResult> {
    return this.net.chat(text);
  }

  get myId(): string | null {
    return this.me?.id ?? null;
  }

  serverNow(): number {
    return this.net.serverNow();
  }

  private onRound(r: Round): void {
    const wasAlive = this.alive;
    this.alive = r.alive;
    if (wasAlive && !r.alive) {
      // he's gone
      this.hold = null;
      this.authority = null;
      this.shake = Math.max(this.shake, 18);
      this.flash = 1;
      this.sound.death();
      navigator.vibrate?.([30, 40, 60]);
      const rp = this.renderPos();
      const px = this.toScreenX(rp.x);
      const py = this.toScreenY(rp.y);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        this.fx.impact(px, py, Math.cos(a), Math.sin(a), 1);
      }
    } else if (r.alive && r.id !== this.roundId) {
      // revived: snap straight to the fresh body at center
      this.forceSnap = true;
      this.sound.revive();
      this.kickJelly(0, 1, 14);
      setTimeout(() => this.say("i'm back. why.", 1500), 350);
    }
    this.roundId = r.id;
    this.ev.onRound(r, this.me?.id ?? null);
  }

  private onGrabbed(e: GrabbedEvent): void {
    this.say(pick(GRAB_LINES, e.world.e), 1600);
    if (e.who.id !== this.me?.id) {
      this.showTag(`${e.who.name} grabbed Claude`, e.who.color);
      this.sound.grab(0.45);
      const g = e.world.g;
      if (g) {
        const rp = this.renderPos();
        const p = this.attachScreen(rp, g.ox, g.oy);
        this.fx.ring(p.x, p.y, e.who.color, 40);
      }
    }
    this.applySnapshot(e.world);
  }

  private onReleased(e: ReleasedEvent): void {
    if (e.who.id === this.me?.id && this.hold && e.forced) {
      // someone knocked him out of our hands
      this.hold = null;
      this.authority = null;
    }
    if (e.who.id !== this.me?.id) {
      this.sound.release(e.speed, 0.5);
      const c = this.cursors.get(e.who.id);
      if (c) c.releasedAt = performance.now();
    }
    this.applySnapshot(e.world);
  }

  private onHype(h: Hype): void {
    if (h.kind === "launched") {
      this.shake = Math.max(this.shake, 14);
      if (!this.hold) this.sound.launch();
    } else {
      this.shake = Math.max(this.shake, 6);
    }
    this.ev.onHype(h);
  }

  private applySnapshot(s: Snapshot): void {
    // drop out-of-order / stale packets
    if (s.e < this.lastEpoch || (s.e === this.lastEpoch && s.t < this.lastSnapT)) return;
    this.lastEpoch = s.e;
    this.lastSnapT = s.t;
    this.homing = s.h === 1;
    this.serverDamage = s.d ?? 0;

    const prevRemote = this.remote;
    this.remote = s.g && s.g.id !== this.me?.id ? { ...s.g, t: s.t } : null;
    if (prevRemote && prevRemote.id !== this.remote?.id) {
      const c = this.cursors.get(prevRemote.id);
      if (c) c.releasedAt = performance.now();
    }

    if (this.authority) {
      const stale = performance.now() - this.authority.since > 2500 && !this.hold;
      const waiting = this.authority.until === null || s.e < this.authority.until;
      if (waiting && !stale) return;
      this.authority = null;
    }
    if (this.hold) return;

    // Fast-forward the snapshot to "now" with the shared physics.
    const pred = copyBody(s);
    const age = clamp((this.net.serverNow() - s.t) / 1000, 0, 0.3);
    if (s.g) {
      const lead = Math.min(age, TARGET_LEAD_S);
      stepBody(pred, lead, { grab: { ...s.g } });
      stepBody(pred, age - lead, {
        grab: { ...s.g, tx: s.g.tx + s.g.tvx * lead, ty: s.g.ty + s.g.tvy * lead, tvx: 0, tvy: 0 },
      });
    } else {
      stepBody(pred, age, { homing: this.homing });
    }

    if (this.forceSnap) {
      this.forceSnap = false;
      this.sim = pred;
      this.off = { x: 0, y: 0, a: 0 };
      return;
    }
    // Keep drawing where we were; let the difference decay.
    this.off.x += this.sim.x - pred.x;
    this.off.y += this.sim.y - pred.y;
    this.off.a = wrapAngle(this.off.a + wrapAngle(this.sim.a - pred.a));
    this.sim = pred;
    if (Math.hypot(this.off.x, this.off.y) > 350) this.off = { x: 0, y: 0, a: 0 };
  }

  private onVisibility(): void {
    if (document.visibilityState === "hidden") {
      this.release();
      return;
    }
    // Tab woke up: our sim is stale. Ask for the truth and snap to it.
    this.forceSnap = true;
    this.lastFrame = performance.now();
    this.net.requestSync();
  }

  // ── frame loop ────────────────────────────────────────────────────────

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const rawDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (rawDt > 0.5) {
      this.forceSnap = true;
      this.net.requestSync();
    }
    const dt = Math.min(rawDt, 1 / 20);

    this.simulate(now, dt);
    this.render(now, dt);
    this.network(now);
  };

  private simulate(now: number, dt: number): void {
    let grab: GrabConstraint | null = null;
    const hold = this.hold;
    if (hold) {
      const tv = this.pointerVelocity(now, 50);
      grab = {
        tx: this.toWorldX(this.pointer.x) + hold.shiftX,
        ty: this.toWorldY(this.pointer.y) + hold.shiftY,
        tvx: tv.x,
        tvy: tv.y,
        ox: hold.ox,
        oy: hold.oy,
      };
    } else if (this.remote) {
      grab = this.remoteConstraint(this.remote);
    }

    stepBody(this.sim, dt, {
      grab,
      homing: !grab && this.homing,
      onWall: (h) => this.onWall(h),
    });

    const k = Math.exp(-dt / SMOOTH_TAU);
    this.off.x *= k;
    this.off.y *= k;
    this.off.a *= k;
  }

  private remoteConstraint(g: GrabInfo & { t: number }): GrabConstraint {
    const since = clamp((this.net.serverNow() - g.t) / 1000, 0, 1);
    const lead = Math.min(since, TARGET_LEAD_S);
    const live = since < TARGET_LEAD_S;
    return {
      tx: g.tx + g.tvx * lead,
      ty: g.ty + g.tvy * lead,
      tvx: live ? g.tvx : 0,
      tvy: live ? g.tvy : 0,
      ox: g.ox,
      oy: g.oy,
    };
  }

  private onWall(hit: WallHit): void {
    if (hit.speed < 140) return;
    const now = performance.now();
    if (now - this.lastWallFx < 50) return;
    this.lastWallFx = now;

    const s = clamp((hit.speed - 140) / 2600, 0, 1);
    const cx = this.toScreenX(clamp(hit.x + this.off.x, 0, WORLD_W));
    const cy = this.toScreenY(clamp(hit.y + this.off.y, 0, WORLD_H));
    // contact point sits exactly on the screen edge
    const px = hit.nx > 0 ? 0 : hit.nx < 0 ? this.W : cx;
    const py = hit.ny > 0 ? 0 : hit.ny < 0 ? this.H : cy;
    this.fx.impact(px, py, hit.nx, hit.ny, s);
    this.kickJelly(hit.nx, hit.ny, 5 + s * 16);
    this.sound.impact(s);
    if (hit.speed > 1500) this.smashedUntil = now + 900;
    if (hit.speed > 1000) this.shake = Math.max(this.shake, 2 + s * 9);
    if (hit.speed > 1300) this.flash = Math.max(this.flash, 0.35 + s * 0.6);
    if (hit.speed > 1800 && now - this.lastQuip > 2500 && Math.random() < 0.5) {
      this.lastQuip = now;
      this.say(pick(IMPACT_LINES), 1200);
    }
    if (this.hold && hit.speed > 600) navigator.vibrate?.(12);
    const free = !this.hold && !this.remote;
    const dmg = this.alive && free ? wallDamage(hit.speed) : 0;
    if (dmg >= 1 && now - this.lastWallNumber > 250) {
      this.lastWallNumber = now;
      this.damageNumber(dmg, "#D97757");
    }
  }

  private kickJelly(nx: number, ny: number, strength: number): void {
    this.jelly.nx = nx;
    this.jelly.ny = ny;
    this.jelly.vel -= strength;
  }

  private attachScreen(rp: { x: number; y: number; a: number }, ox: number, oy: number) {
    const c = Math.cos(rp.a);
    const s = Math.sin(rp.a);
    const k = this.r / RADIUS;
    return {
      x: this.toScreenX(rp.x) + (ox * c - oy * s) * k,
      y: this.toScreenY(rp.y) + (ox * s + oy * c) * k,
    };
  }

  private render(now: number, dt: number): void {
    const d = this.dom;
    const rp = this.renderPos();
    const px = this.toScreenX(rp.x);
    const py = this.toScreenY(rp.y);
    const svx = this.sim.vx * this.sx;
    const svy = this.sim.vy * this.sy;
    const speedPx = Math.hypot(svx, svy);
    const speedW = speedOf(this.sim);
    const held = !!this.hold || !!this.remote;

    // hover (desktop only)
    const pdx = this.pointer.x - px;
    const pdy = this.pointer.y - py;
    const pd = Math.hypot(pdx, pdy);
    this.hover = this.pointer.active && this.pointer.mouse && pd < this.r * 1.05;

    // idle bob + lift
    const idle = !held && speedPx < 25;
    this.bobAmp += ((idle ? 1 : 0) - this.bobAmp) * Math.min(1, dt * 3);
    const bob = Math.sin(now / 1000 * 2.1) * 3.5 * this.bobAmp;
    const liftTarget = this.hold ? 1.07 : this.remote ? 1.04 : this.hover ? 1.04 : 1;
    this.lift += (liftTarget - this.lift) * Math.min(1, dt * 14);

    // velocity stretch
    const st = Math.min(speedPx / 3800, 0.24);
    const vAng = Math.atan2(svy, svx);

    // impact jelly (damped spring)
    const j = this.jelly;
    j.vel += (-560 * j.amp - 11 * j.vel) * dt;
    j.amp = clamp(j.amp + j.vel * dt, -0.34, 0.34);
    const jAng = Math.atan2(j.ny, j.nx);

    if (this.firstFrame) {
      this.firstFrame = false;
      d.claude.style.opacity = "1";
    }
    d.claude.style.transform = `translate3d(${px - this.r}px, ${py - this.r + bob}px, 0)`;
    d.stretch.style.transform = `rotate(${vAng}rad) scale(${1 + st}, ${1 - st * 0.6}) rotate(${-vAng}rad)`;
    d.jelly.style.transform = `rotate(${jAng}rad) scale(${1 + j.amp}, ${1 - j.amp * 0.75}) rotate(${-jAng}rad) scale(${this.lift})`;
    d.spin.style.transform = `rotate(${rp.a}rad)`;
    const liftK = (this.lift - 1) / 0.07;
    d.shadow.style.transform = `translate3d(0, ${this.r * (0.2 + 0.18 * liftK) - bob * 0.6}px, 0) scale(${1 + st * 0.5 - liftK * 0.08}, ${0.92 - st * 0.3})`;
    d.shadow.style.opacity = `${0.55 - liftK * 0.22}`;

    const blur = speedPx > 2600;
    if (blur !== this.blurred) {
      this.blurred = blur;
      d.stretch.classList.toggle("is-blurred", blur);
    }

    // eyes: look at the pointer when idle, along velocity when flying
    let lx = 0;
    let ly = 0;
    if (speedPx > 120) {
      lx = svx / speedPx;
      ly = svy / speedPx;
    } else if (this.pointer.active && this.pointer.mouse && pd > 1) {
      const k = Math.min(pd / 260, 1);
      lx = (pdx / pd) * k;
      ly = (pdy / pd) * k;
    }
    // into Claude's rotating local frame
    const ca = Math.cos(-rp.a);
    const sa = Math.sin(-rp.a);
    const llx = lx * ca - ly * sa;
    const lly = lx * sa + ly * ca;
    this.look.x += (llx - this.look.x) * Math.min(1, dt * 10);
    this.look.y += (lly - this.look.y) * Math.min(1, dt * 10);
    d.claude.style.setProperty("--lx", this.look.x.toFixed(3));
    d.claude.style.setProperty("--ly", this.look.y.toFixed(3));

    // expression
    let expr: Expression = "idle";
    if (!this.alive) expr = "dead";
    else if (held) expr = speedW > 2400 ? "woozy" : "grabbed";
    else if (now < this.smashedUntil) expr = "smashed";
    else if (speedW > 1300 || Math.abs(this.sim.av) > 14) {
      expr = "woozy";
      this.woozyUntil = now + 450;
    } else if (now < this.woozyUntil) expr = "woozy";
    else if (this.hover) expr = "curious";
    if (expr !== this.expression) {
      this.expression = expr;
      this.ev.onExpression(expr);
    }

    // shared damage → tint, tiers, vignette
    this.damage += (this.serverDamage - this.damage) * Math.min(1, dt * 4);
    d.claude.style.setProperty("--dmg", this.damage.toFixed(3));
    const level = this.damage >= 0.85 ? 3 : this.damage >= 0.5 ? 2 : this.damage >= 0.2 ? 1 : 0;
    if (level !== this.damageLevel) {
      this.damageLevel = level;
      this.ev.onDamage(level);
    }
    this.flash *= Math.exp(-dt * 5);
    d.hurt.style.opacity = Math.max(this.flash, this.damage * 0.3).toFixed(3);

    const hp = Math.round(MAX_HP * (1 - this.serverDamage));
    if (hp !== this.hp) {
      this.hp = hp;
      this.ev.onHp(hp);
    }

    // things he says (the dead don't talk)
    if (!this.alive) {
      this.wasHover = this.hover;
    } else if (this.hover && !this.wasHover && !held && now - this.lastScared > 6000) {
      this.lastScared = now;
      this.say(pick(SCARED_LINES), 1100);
    }
    this.wasHover = this.hover;
    if (idle && this.damage > 0.5 && now > this.bubbleUntil + 4000 && now - this.lastQuip > 7000) {
      this.lastQuip = now;
      this.say(pick(BROKEN_LINES), 1800);
    }

    // cursor style
    const cs =
      this.item !== "hand"
        ? `item:${this.item}`
        : this.hold
          ? "grabbing"
          : this.hover
            ? this.remote || !this.alive
              ? "not-allowed"
              : "grab"
            : "";
    if (cs !== this.cursorStyle) {
      this.cursorStyle = cs;
      d.stage.style.cursor = this.item !== "hand" ? itemCursor(this.item) : cs;
    }

    // screen shake (reduced for prefers-reduced-motion)
    this.shake *= Math.exp(-dt * 8);
    if (this.shake > 0.15) {
      const m = this.reducedMotion ? 0.25 : 1;
      const a = this.shake * m;
      const t = now / 1000;
      const ox = (Math.sin(t * 91.7) + Math.sin(t * 57.3) * 0.6) * a * 0.6;
      const oy = (Math.cos(t * 83.1) + Math.sin(t * 61.9) * 0.6) * a * 0.6;
      d.stage.style.transform = `translate3d(${ox}px, ${oy}px, 0) rotate(${Math.sin(t * 47) * a * 0.04}deg)`;
      this.shaking = true;
    } else if (this.shaking) {
      this.shaking = false;
      d.stage.style.transform = "";
    }

    this.fx.track(px, py + bob, this.r * this.lift, speedPx);
    this.fx.render(dt);
    this.renderPresence(now, rp, px, py);
  }

  // ── items ─────────────────────────────────────────────────────────────
  //
  // Your own hits animate instantly on click; the server's "used" echo then
  // carries the authoritative knockback + damage. Everyone else plays the
  // same animation from your pointer position when that echo arrives.

  setItem(id: ItemId): void {
    if (id === this.item) return;
    if (this.hold && id !== "hand") this.release();
    this.item = id;
    this.ev.onItem(id);
  }

  private useItem(sx: number, sy: number, touch: boolean): void {
    const def = ITEMS[this.item];
    if (!this.grabbedOnce) {
      this.grabbedOnce = true;
      this.ev.onFirstGrab();
    }
    if (!this.alive) {
      this.showTag("he's dead. hit revive.", "#6B6B6B");
      return;
    }
    const now = performance.now();
    if ((this.readyAt.get(def.id) ?? 0) > now) return;
    if (def.heal && this.hp >= MAX_HP) {
      this.popWord("already full", sx, sy, "#6B6B6B", true);
      return;
    }

    const rp = this.renderPos();
    const px = this.toScreenX(rp.x);
    const py = this.toScreenY(rp.y);
    const reach = this.r * def.reach * (touch ? 1.15 : 1);
    if (Math.hypot(sx - px, sy - py) > reach) {
      this.popWord("too far", sx, sy, "#6B6B6B", true);
      return;
    }
    this.readyAt.set(def.id, now + def.cooldownMs);
    this.ev.onCooldown(def.id, def.cooldownMs);
    this.net.use({ item: def.id, x: this.toWorldX(sx), y: this.toWorldY(sy) });
    this.playUse(def.id, sx, sy, this.me?.color ?? "#D97757", 1);
    navigator.vibrate?.(14);
  }

  private onUsed(e: UsedEvent): void {
    const mine = e.who.id === this.me?.id;
    const sx = this.toScreenX(e.x);
    const sy = this.toScreenY(e.y);
    if (e.phase === "boom") {
      this.playBoom();
    } else if (!mine) {
      this.onCursor({ ...e.who, x: e.x, y: e.y });
      const c = this.cursors.get(e.who.id);
      if (c) c.releasedAt = performance.now();
      this.playUse(e.item, sx, sy, e.who.color, 0.6);
      if (e.phase === "hit") {
        const verb = e.heal > 0 ? "healed Claude with the" : "used the";
        this.showTag(`${e.who.name} ${verb} ${ITEMS[e.item].name}`, e.who.color);
      }
    }
    if (e.world) {
      // item hits are server-authored: drop any stale local authority
      if (!e.heal) this.authority = null;
      this.applySnapshot(e.world);
    }
    if (e.damage > 0) this.damageNumber(e.damage, e.who.color);
    if (e.heal > 0) this.damageNumber(-e.heal, "#22C55E");
  }

  private playUse(item: ItemId, sx: number, sy: number, color: string, vol: number): void {
    const def = ITEMS[item];
    const rp = this.renderPos();
    const px = this.toScreenX(rp.x);
    const py = this.toScreenY(rp.y);
    let dx = px - sx;
    let dy = py - sy;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;

    switch (item) {
      case "whip": {
        // the lash lands on the near side of him
        const ex = px - dx * this.r * 0.55;
        const ey = py - dy * this.r * 0.55;
        this.fx.lash(sx, sy, ex, ey);
        setTimeout(() => {
          this.sound.item("whip", vol);
          this.fx.impact(ex, ey, -dx, -dy, 0.6);
          this.kickJelly(dx, dy, 12);
          this.flash = Math.max(this.flash, 0.25);
          this.popWord(def.word, ex, ey - 20, color);
          this.say(pick(IMPACT_LINES), 900);
        }, 90);
        break;
      }
      case "hammer": {
        const el = this.sprite(item, px + this.r * 0.15, py - this.r * 0.95, this.r * 1.1, "item-hammer");
        setTimeout(() => el.remove(), 600);
        setTimeout(() => {
          this.sound.item("hammer", vol);
          this.shake = Math.max(this.shake, 9);
          this.kickJelly(0, 1, 22);
          this.smashedUntil = performance.now() + 900;
          this.fx.impact(px, py - this.r * 0.7, 0, 1, 0.8);
          this.popWord(def.word, px, py - this.r * 1.1, color);
        }, 150);
        break;
      }
      case "taser": {
        this.fx.bolt(sx, sy, px, py);
        this.sound.item("taser", vol);
        this.dom.claude.classList.add("is-zapped");
        setTimeout(() => this.dom.claude.classList.remove("is-zapped"), 450);
        this.flash = Math.max(this.flash, 0.2);
        this.popWord(def.word, px, py - this.r * 0.9, color);
        break;
      }
      case "bomb": {
        const el = this.sprite(item, px, py, this.r * 0.75, "item-bomb");
        this.bombs.push(el);
        this.sound.item("fuse", vol);
        this.say("is that… ticking?", 900);
        // safety: never leave a bomb hanging if the boom never arrives
        setTimeout(() => this.removeBomb(el), (def.fuseMs ?? 900) + 1500);
        break;
      }
      case "tokens":
      case "water": {
        const big = item === "water";
        const el = this.sprite(item, px + (Math.random() - 0.5) * this.r * 0.6, py - this.r * 0.2, this.r * (big ? 0.8 : 0.5), "item-heal");
        setTimeout(() => el.remove(), 700);
        this.fx.heal(px, py, this.r, big);
        this.sound.item(item, vol);
        this.kickJelly(0, -1, big ? 8 : 3);
        if (big) this.popWord(def.word, px, py - this.r * 1.05, "#15803D");
        if (big || Math.random() < 0.2) this.say(pick(HEAL_LINES), 1200);
        break;
      }
    }
  }

  private playBoom(): void {
    const b = this.bombs[0];
    if (b) this.removeBomb(b);
    const rp = this.renderPos();
    const px = this.toScreenX(rp.x);
    const py = this.toScreenY(rp.y);
    this.fx.explode(px, py);
    this.sound.item("bomb");
    this.shake = Math.max(this.shake, 22);
    this.flash = 1;
    this.kickJelly(0, 1, 26);
    this.smashedUntil = performance.now() + 1200;
    this.popWord(ITEMS.bomb.word, px, py - this.r, "#1D1D1F");
    navigator.vibrate?.([20, 30, 40]);
  }

  private removeBomb(el: HTMLDivElement): void {
    el.remove();
    this.bombs = this.bombs.filter((b) => b !== el);
  }

  private sprite(item: ItemId, x: number, y: number, size: number, cls: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `item-sprite ${cls}`;
    el.style.width = el.style.height = `${size}px`;
    el.style.left = `${x - size / 2}px`;
    el.style.top = `${y - size / 2}px`;
    el.innerHTML = ITEM_ART[item];
    this.dom.overlay.appendChild(el);
    return el;
  }

  private popWord(text: string, x: number, y: number, color: string, small = false): void {
    if (!text) return;
    const el = document.createElement("div");
    el.className = small ? "pop-word is-small" : "pop-word";
    el.textContent = text;
    el.style.setProperty("--c", color);
    el.style.setProperty("--tilt", `${(Math.random() - 0.5) * 16}deg`);
    el.style.left = `${clamp(x, 60, this.W - 60)}px`;
    el.style.top = `${clamp(y, 40, this.H - 40)}px`;
    this.dom.overlay.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  private damageNumber(n: number, color: string): void {
    const rp = this.renderPos();
    const el = document.createElement("div");
    el.className = n < 0 ? "dmg-number is-heal" : "dmg-number";
    el.textContent = n < 0 ? `+${Math.max(1, Math.round(-n))}` : `-${Math.max(1, Math.round(n))}`;
    el.style.setProperty("--c", color);
    el.style.setProperty("--dx", `${(Math.random() - 0.5) * 60}px`);
    el.style.left = `${this.toScreenX(rp.x) + (Math.random() - 0.5) * this.r}px`;
    el.style.top = `${this.toScreenY(rp.y) - this.r * 0.6}px`;
    this.dom.overlay.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  // ── remote presence ───────────────────────────────────────────────────

  private onCursor(c: RemoteCursor): void {
    let v = this.cursors.get(c.id);
    if (!v) {
      const el = document.createElement("div");
      el.className = "remote-cursor";
      el.style.setProperty("--c", c.color);
      el.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M2 1.5 L15.5 8.2 L9.4 9.6 L6.6 15.6 Z" fill="var(--c)" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg><span class="remote-cursor-dot"></span><span class="remote-cursor-name"></span>';
      (el.querySelector(".remote-cursor-name") as HTMLSpanElement).textContent = c.name;
      this.dom.overlay.appendChild(el);
      v = {
        id: c.id,
        el,
        x: this.toScreenX(c.x),
        y: this.toScreenY(c.y),
        wx: c.x,
        wy: c.y,
        seenAt: 0,
        releasedAt: 0,
        shown: false,
        grabbing: false,
      };
      this.cursors.set(c.id, v);
    }
    v.wx = c.x;
    v.wy = c.y;
    v.seenAt = performance.now();
  }

  private removeCursor(id: string): void {
    const v = this.cursors.get(id);
    if (!v) return;
    v.el.remove();
    this.cursors.delete(id);
  }

  private ensureCursor(g: GrabInfo): CursorView {
    if (!this.cursors.has(g.id)) {
      const rp = this.renderPos();
      this.onCursor({ id: g.id, name: g.name, color: g.color, x: rp.x, y: rp.y });
    }
    return this.cursors.get(g.id)!;
  }

  private renderPresence(now: number, rp: { x: number; y: number; a: number }, px: number, py: number): void {
    // Grab tag sits under Claude, his speech bubble above-right.
    this.dom.tag.style.transform = `translate3d(${px}px, ${py + this.r * this.lift * 0.62 + 12}px, 0) translate(-50%, 0)`;
    const bx = clamp(px + this.r * 0.35, 8, this.W - 230);
    const by = Math.max(py - this.r * this.lift * 0.55 - 10, 60);
    this.dom.bubble.style.transform = `translate3d(${bx}px, ${by}px, 0) translate(0, -100%)`;

    // armed bombs ride along on him
    for (let i = 0; i < this.bombs.length; i++) {
      const el = this.bombs[i];
      const s = parseFloat(el.style.width);
      el.style.left = `${px + this.r * (0.25 + i * 0.2) - s / 2}px`;
      el.style.top = `${py - this.r * 0.35 - s / 2}px`;
    }

    const grabberId = this.remote?.id;
    if (this.remote) {
      const v = this.ensureCursor(this.remote);
      const p = this.attachScreen(rp, this.remote.ox, this.remote.oy);
      v.x = p.x;
      v.y = p.y;
      v.wx = this.toWorldX(p.x);
      v.wy = this.toWorldY(p.y);
      v.seenAt = now;
    }

    // Only show cursors that are holding, near, or recently interacted with
    // Claude — never a swarm of idle pointers.
    for (const v of this.cursors.values()) {
      const grabbing = v.id === grabberId;
      if (!grabbing) {
        const tx = this.toScreenX(v.wx);
        const ty = this.toScreenY(v.wy);
        v.x += (tx - v.x) * 0.3;
        v.y += (ty - v.y) * 0.3;
      }
      const near = Math.hypot(v.x - px, v.y - py) < this.r * 3.4;
      const visible =
        grabbing || (now - v.seenAt < 1200 && near) || now - v.releasedAt < 1000;
      if (visible !== v.shown) {
        v.shown = visible;
        v.el.classList.toggle("is-visible", visible);
      }
      if (grabbing !== v.grabbing) {
        v.grabbing = grabbing;
        v.el.classList.toggle("is-grabbing", grabbing);
      }
      if (visible || v.shown) v.el.style.transform = `translate3d(${v.x}px, ${v.y}px, 0)`;
    }
  }

  private showTag(text: string, color: string): void {
    const tag = this.dom.tag;
    tag.style.setProperty("--c", color);
    (tag.querySelector("[data-text]") as HTMLElement).textContent = text;
    tag.classList.remove("is-visible");
    void tag.offsetWidth; // restart transition
    tag.classList.add("is-visible");
    if (this.tagTimer) clearTimeout(this.tagTimer);
    this.tagTimer = setTimeout(() => tag.classList.remove("is-visible"), 1050);
  }

  private say(text: string, ms: number): void {
    const b = this.dom.bubble;
    (b.querySelector("[data-text]") as HTMLElement).textContent = text;
    b.classList.remove("is-visible");
    void b.offsetWidth;
    b.classList.add("is-visible");
    this.bubbleUntil = performance.now() + ms;
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => b.classList.remove("is-visible"), ms);
  }

  // ── outbound network pacing ───────────────────────────────────────────

  private network(now: number): void {
    if (!this.net.connected) return;

    if (this.hold && this.authority) {
      if (now - this.lastDragSent >= DRAG_SEND_MS) {
        this.lastDragSent = now;
        const tv = this.pointerVelocity(now, 50);
        this.net.drag({
          x: this.toWorldX(this.pointer.x) + this.hold.shiftX,
          y: this.toWorldY(this.pointer.y) + this.hold.shiftY,
          vx: tv.x,
          vy: tv.y,
        });
      }
      return;
    }

    // Cursor presence: only while near Claude, ~12 Hz.
    if (this.pointer.active && now - this.lastCursorSent >= CURSOR_SEND_MS) {
      const rp = this.renderPos();
      const d = Math.hypot(this.pointer.x - this.toScreenX(rp.x), this.pointer.y - this.toScreenY(rp.y));
      if (d < this.r * 3.2) {
        this.lastCursorSent = now;
        this.net.cursor({ x: this.toWorldX(this.pointer.x), y: this.toWorldY(this.pointer.y) });
      }
    }
  }
}
