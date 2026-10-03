import { Pool } from "pg";
import { dayNumber } from "../daily";

/**
 * Global Daily Claude totals: how many played each puzzle, how many KO'd him,
 * and in how many moves. Stored in Postgres when DATABASE_URL is set (survives
 * redeploys, safe with several replicas); otherwise in memory, for local dev.
 *
 * Each browser counts once per puzzle (by a random id it keeps). One network
 * can submit at most IP_LIMIT results per puzzle, so a dorm or office still
 * works but faking results needs a lot of different networks.
 */

export interface DayView {
  players: number;
  kills: number;
  dist: Record<number, number>;
}

export interface Submission {
  day: number;
  id: string;
  ip: string;
  killed: boolean;
  moves: number;
}

interface Backend {
  get(day: number): Promise<DayView>;
  submit(s: Submission): Promise<DayView>;
}

const IP_LIMIT = 40;

/**
 * Only today's and yesterday's puzzles are kept (by the server's date). The
 * API never accepts anything older, and players' local dates are at most a
 * day behind, so older results are never read again.
 */
function oldestKeptDay(): number {
  return dayNumber() - 1;
}

class MemoryBackend implements Backend {
  private days = new Map<number, { view: DayView; seen: Set<string>; ips: Map<string, number> }>();

  private day(day: number) {
    let d = this.days.get(day);
    if (!d) {
      d = { view: { players: 0, kills: 0, dist: {} }, seen: new Set(), ips: new Map() };
      this.days.set(day, d);
      const oldest = oldestKeptDay();
      for (const k of this.days.keys()) if (k < oldest) this.days.delete(k);
    }
    return d;
  }

  async get(day: number) {
    return this.day(day).view;
  }

  async submit({ day, id, ip, killed, moves }: Submission) {
    const d = this.day(day);
    if (d.seen.has(id)) return d.view;
    d.seen.add(id);
    const n = (d.ips.get(ip) ?? 0) + 1;
    d.ips.set(ip, n);
    if (n > IP_LIMIT) return d.view;
    d.view.players++;
    if (killed) {
      d.view.kills++;
      d.view.dist[moves] = (d.view.dist[moves] ?? 0) + 1;
    }
    return d.view;
  }
}

/** One row per counted result, kept for two days; totals are computed on read. */
class PostgresBackend implements Backend {
  private setup: Promise<unknown> | null = null;

  constructor(private pool: Pool) {}

  /** Creates the table on first use; retried on the next request if the database was down. */
  private get ready(): Promise<unknown> {
    this.setup ??= this.pool
      .query(
        `
      CREATE TABLE IF NOT EXISTS daily_results (
        day        integer     NOT NULL,
        player_id  text        NOT NULL,
        ip         text        NOT NULL,
        killed     boolean     NOT NULL,
        moves      integer     NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (day, player_id)
      );
      CREATE INDEX IF NOT EXISTS daily_results_day_ip ON daily_results (day, ip);
    `,
      )
      .catch((e) => {
        this.setup = null;
        throw e;
      });
    return this.setup;
  }

  async get(day: number): Promise<DayView> {
    await this.ready;
    const { rows } = await this.pool.query<{ killed: boolean; moves: number; n: string }>(
      "SELECT killed, moves, count(*) AS n FROM daily_results WHERE day = $1 GROUP BY killed, moves",
      [day],
    );
    const view: DayView = { players: 0, kills: 0, dist: {} };
    for (const r of rows) {
      const n = Number(r.n);
      view.players += n;
      if (r.killed) {
        view.kills += n;
        view.dist[r.moves] = n;
      }
    }
    return view;
  }

  async submit({ day, id, ip, killed, moves }: Submission): Promise<DayView> {
    await this.ready;
    // The IP check and insert aren't atomic; a burst could slip a few past the limit, which is fine.
    const { rows } = await this.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM daily_results WHERE day = $1 AND ip = $2",
      [day, ip],
    );
    if (Number(rows[0].n) < IP_LIMIT) {
      await this.pool.query(
        `INSERT INTO daily_results (day, player_id, ip, killed, moves)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (day, player_id) DO NOTHING`,
        [day, id, ip, killed, moves],
      );
    }
    this.prune();
    return this.get(day);
  }

  private prunedFor = -1;

  /** Deletes old puzzles once per server day; runs in the background. */
  private prune(): void {
    const oldest = oldestKeptDay();
    if (oldest === this.prunedFor) return;
    this.prunedFor = oldest;
    this.pool.query("DELETE FROM daily_results WHERE day < $1", [oldest]).catch((e) => {
      this.prunedFor = -1;
      console.error("[daily] prune failed:", e.message);
    });
  }
}

function createBackend(): Backend {
  const url = process.env.DATABASE_URL;
  if (!url) return new MemoryBackend();
  const pool = new Pool({ connectionString: url, max: 5 });
  pool.on("error", (e) => console.error("[daily] postgres:", e.message));
  return new PostgresBackend(pool);
}

const g = globalThis as unknown as { __dailyBackend?: Backend };
export const dailyStats: Backend = (g.__dailyBackend ??= createBackend());
