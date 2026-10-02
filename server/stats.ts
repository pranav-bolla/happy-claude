import type { PlayerIdentity, Stats } from "../lib/protocol";

/**
 * Stats are behind an interface so the in-memory counter can be swapped for
 * a persisted global one (Redis, Postgres, KV...) without touching the
 * game loop. A persisted store should keep an in-memory copy for reads and
 * flush writes in the background so physics never waits on I/O.
 */
export interface StatsStore {
  get(): Stats;
  /** Record a whip. Returns true if it set a new top speed. */
  recordWhip(speed: number): boolean;
  /** Record a kill. Returns true if it's the new time to beat. */
  recordKill(ms: number, killer: PlayerIdentity | null): boolean;
  /** Optional hook for persisted stores (called on shutdown). */
  flush?(): Promise<void>;
}

export class MemoryStatsStore implements StatsStore {
  private stats: Stats = { whips: 0, topSpeed: 0, kills: 0, bestKillMs: null, bestKiller: null };

  get(): Stats {
    return { ...this.stats };
  }

  recordWhip(speed: number): boolean {
    this.stats.whips += 1;
    if (speed > this.stats.topSpeed) {
      this.stats.topSpeed = Math.round(speed);
      return true;
    }
    return false;
  }

  recordKill(ms: number, killer: PlayerIdentity | null): boolean {
    this.stats.kills += 1;
    if (this.stats.bestKillMs === null || ms < this.stats.bestKillMs) {
      this.stats.bestKillMs = Math.round(ms);
      this.stats.bestKiller = killer;
      return true;
    }
    return false;
  }
}
