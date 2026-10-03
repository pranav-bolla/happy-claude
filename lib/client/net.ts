import { io, type Socket } from "socket.io-client";
import {
  SOCKET_PATH,
  type ChatMessage,
  type ChatResult,
  type CursorInput,
  type DragInput,
  type FeedItem,
  type GrabRequest,
  type GrabResult,
  type GrabbedEvent,
  type Hype,
  type PlayerIdentity,
  type ReleaseInput,
  type ReleasedEvent,
  type RemoteCursor,
  type Round,
  type Snapshot,
  type UseInput,
  type UsedEvent,
  type Stats,
  type Welcome,
} from "../protocol";

export type ConnStatus = "connecting" | "connected" | "disconnected";

export interface NetHandlers {
  onStatus(s: ConnStatus): void;
  onWelcome(w: Welcome): void;
  onSnapshot(s: Snapshot): void;
  onGrabbed(e: GrabbedEvent): void;
  onReleased(e: ReleasedEvent): void;
  onPlayers(n: number): void;
  onStats(s: Stats): void;
  onFeed(f: FeedItem): void;
  onHype(h: Hype): void;
  onCursor(c: RemoteCursor): void;
  onLeft(id: string): void;
  onRound(r: Round): void;
  onUsed(e: UsedEvent): void;
  onChat(m: ChatMessage): void;
}

const IDENTITY_KEY = "whip-claude:identity";

/**
 * Thin wrapper around Socket.IO that also keeps an estimate of the server
 * clock. Snapshots are timestamped with server time; knowing the offset and
 * round-trip time lets the engine fast-forward each snapshot to "now".
 */
export class Net {
  private socket: Socket;
  private clockSamples: { rtt: number; offset: number }[] = [];
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  /** serverTime ≈ Date.now() + clockOffset */
  clockOffset = 0;
  rtt = 100;

  constructor(private h: NetHandlers) {
    this.socket = io({
      path: SOCKET_PATH,
      transports: ["websocket", "polling"],
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
      // re-read on every (re)connect so a reconnect keeps your name
      auth: (cb) => cb(loadIdentity() ?? {}),
    });

    const s = this.socket;
    h.onStatus("connecting");
    s.on("connect", () => {
      this.clockSamples = [];
      this.syncClock();
      setTimeout(() => this.syncClock(), 150);
      setTimeout(() => this.syncClock(), 400);
    });
    s.on("disconnect", () => h.onStatus("disconnected"));
    s.on("connect_error", () => h.onStatus(s.active ? "disconnected" : "connecting"));

    s.on("welcome", (w: Welcome) => {
      saveIdentity(w.you);
      h.onStatus("connected");
      h.onWelcome(w);
    });
    s.on("s", h.onSnapshot);
    s.on("world", h.onSnapshot);
    s.on("grabbed", h.onGrabbed);
    s.on("released", h.onReleased);
    s.on("players", h.onPlayers);
    s.on("stats", h.onStats);
    s.on("feed", h.onFeed);
    s.on("hype", h.onHype);
    s.on("cursor", h.onCursor);
    s.on("left", h.onLeft);
    s.on("round", h.onRound);
    s.on("used", h.onUsed);
    s.on("chat", h.onChat);

    this.clockTimer = setInterval(() => this.syncClock(), 4000);
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  /** Estimated one-way latency in seconds. */
  latency(): number {
    return Math.min(this.rtt / 2, 300) / 1000;
  }

  grab(req: GrabRequest): Promise<GrabResult> {
    return new Promise((resolve) => {
      this.socket.timeout(2000).emit("grab", req, (err: unknown, res: GrabResult) => {
        resolve(err || !res ? { ok: false } : res);
      });
    });
  }

  /** Drag + cursor packets are volatile: if the link hiccups, drop them
   *  instead of replaying a burst of stale positions later. */
  drag(d: DragInput): void {
    this.socket.volatile.emit("drag", d);
  }

  cursor(c: CursorInput): void {
    this.socket.volatile.emit("cursor", c);
  }

  /** Release must arrive, so it's reliable. */
  release(r: ReleaseInput): void {
    if (this.socket.connected) this.socket.emit("release", r);
  }

  use(u: UseInput): void {
    if (this.socket.connected) this.socket.emit("use", u);
  }

  revive(): void {
    if (this.socket.connected) this.socket.emit("revive");
  }

  chat(text: string): Promise<ChatResult> {
    if (!this.socket.connected) return Promise.resolve({ ok: false, reason: "offline" });
    return new Promise((resolve) => {
      this.socket.timeout(3000).emit("chat", text, (err: unknown, res: ChatResult) => {
        resolve(err || !res ? { ok: false, reason: "didn't send" } : res);
      });
    });
  }

  requestSync(): void {
    if (this.socket.connected) this.socket.emit("sync");
  }

  destroy(): void {
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  private syncClock(): void {
    if (!this.socket.connected) return;
    const sent = Date.now();
    this.socket.timeout(3000).emit("clock", sent, (err: unknown, serverTime: number) => {
      if (err || typeof serverTime !== "number") return;
      const now = Date.now();
      const rtt = now - sent;
      this.clockSamples.push({ rtt, offset: serverTime + rtt / 2 - now });
      if (this.clockSamples.length > 10) this.clockSamples.shift();
      // The lowest-RTT sample has the least queuing noise → best offset.
      const best = this.clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      this.clockOffset = best.offset;
      this.rtt = this.rtt * 0.7 + rtt * 0.3;
    });
  }
}

function loadIdentity(): Partial<PlayerIdentity> | null {
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY);
    return raw ? (JSON.parse(raw) as PlayerIdentity) : null;
  } catch {
    return null;
  }
}

function saveIdentity(id: PlayerIdentity): void {
  try {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify({ name: id.name, color: id.color }));
  } catch {
    /* private mode etc. */
  }
}
