# HAPPY CLAUDE

- **Play:** https://happy-claude-production.up.railway.app/
- **Daily puzzle:** https://happy-claude-production.up.railway.app/daily

One object. One shared room. Everyone online fighting over it.

A real-time multiplayer physics toy: every visitor grabs, swings and whips the
same Claude. The server is authoritative; browsers predict locally and smooth
corrections so it stays at 60 fps. Players can hurt him with items or heal
him, chat with everyone online, and come back each day for **Daily Claude**,
a solo puzzle with a shareable result.

## The game

Claude has 150 HP, shared by everyone online. Hard wall impacts hurt him,
but only when he's flying free (pinning him against a wall while dragging
does nothing).
The kill clock starts on the first grab after he's revived and stops when
his HP hits zero. The fastest kill ever is the site-wide **time to beat**,
credited to whoever landed the final blow. Each browser also keeps a
personal best for kills it helped with. The death screen shows that life's
leaderboard: **who did this** (damage dealt, with share of the total and a
☠ on the final blow) and **who tried to save him** (HP healed). After he dies anyone can hit
**REVIVE**; he also comes back on his own after 20 s. Wall damage tuning
lives in `lib/protocol.ts` (`HURT_*`).

### Chat

Press **Enter** (or `/`) to chat with everyone online, **Esc** to close. On
phones, tap the chat bubble bottom-left. New players see the last 40
messages. The server caps messages at 140 characters and 5 per 10 seconds,
blocks repeats, and replaces links with `[link]`. History is in memory only.

### Inventory

The hotbar at the bottom holds **hand** (grab and throw), **whip**,
**hammer**, **taser** and **bomb**, then two healing items, **tokens**
(+3, fast) and **water** (+25, slow), for people who'd rather keep him
alive. Pick one by clicking it or pressing 1–7, then click near Claude to
use it. Each item has its own reach, cooldown
and damage (see `lib/items.ts`). The server validates every use, applies the
knockback and damage, and broadcasts it so everyone sees the animation from
your cursor. A hit also knocks Claude out of whoever is holding him. The bomb
sticks to him and goes off after 0.9 s.

### Daily Claude (`/daily`)

A Wordle-style solo puzzle. There's one new puzzle per day at local
midnight, and puzzle #1 was 2026-10-01. Everyone gets the same arena: a square
board with bumpers, spiked walls (double damage), a limited set of items, and a
modifier such as Rubber, Glass Jaw or Heavy. The goal is to KO Claude in as few
moves as possible. Throws and item uses each count as a move. Only your first
attempt each day counts. Afterwards you get your result, your streak, a
moves histogram, and how you compare with everyone else who played today.

**Sharing.** The result is two rows of emoji, what you used on each move
and how hard it hit:

```
Daily Claude #3 💀 6/12
✋🪢✋🔨✋💣
🟨🟧⬛🟥🟧💀
Heavy · 🔥 2
```

The link that comes with it carries your run (`/daily?r=3k-h1w2h0m3h2b3`:
the day, KO or not, then an item letter and damage level for each move). In
iMessage and other chats, the link preview shows your moves with "can you beat
it?". A friend who opens the link sees a **🎯 BEAT 6/12** box before they start,
and their results card says whether they beat you.

- The puzzle is built in `lib/daily.ts`. A seeded RNG turns the day number
  into the spec, so every player gets the same puzzle without a server.
  Changing the order of random calls in `dailySpec`, or the `MODIFIERS`
  list, reshuffles every puzzle. Append new things at the end.
- The game runs entirely in the browser: `Engine` in solo mode with the
  same physics and items as multiplayer.
- Results and streaks are kept in localStorage (`lib/client/dailyStore.ts`).
- Global "you beat X%" stats come from `/api/daily` (`lib/server/dailyStats.ts`).
  Each browser counts once per puzzle, using a random id kept in
  localStorage, and one network can add at most 40 results per puzzle. They're
  stored in Postgres when `DATABASE_URL` is set, and in memory otherwise (reset
  on restart). Only today's and yesterday's puzzles are kept. Results aren't
  verified, so someone could still post fake ones.
- Run codes are encoded and decoded in `lib/daily.ts` (`encodeRun` /
  `decodeRun`). Someone could edit a code to fake a run, but that only
  changes the preview picture, not anyone's stats.

The main page shows a **Daily Claude** card (a bar under the health bar on
phones). It has an orange dot until you've played today's puzzle, then shows your
result. The **–** button shrinks it to a small chip, and **+** brings it
back. It reopens once each new day. The death screen also links to the daily.

### Link previews

Links get a title, a description and a 1200×630 image, so they look good in
group chats.

- `app/opengraph-image.tsx` draws the main site image. It's built once at
  build time.
- `app/daily/og/route.tsx` draws the daily image. It shows the shared run
  when the link has `?r=`, or a generic card otherwise.
- Claude is drawn from the same pixel art as the game (`lib/og.ts`). The fonts
  (Inter and JetBrains Mono, both free to use) are in `assets/fonts/`
  because the built-in font has no bold weight.
- Preview images need the full site address. It comes from `SITE_URL`,
  then `RAILWAY_PUBLIC_DOMAIN`, then the Railway URL above. Set `SITE_URL` if you
  add a custom domain.
- iMessage remembers previews for links it has already seen. To test a
  change, send a link it hasn't seen before (add `?x=1`).

## Run locally

Node.js lives inside the Python virtual environment (`.venv`, via `nodeenv`),
so nothing is installed globally.

```bash
source .venv/bin/activate     # puts node + npm on PATH
npm install                   # first time only
npm run dev                   # http://localhost:3000
```

Fresh machine without `.venv` yet:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install nodeenv && nodeenv -p --node=22.11.0
npm install
```

## Test multiplayer

1. `npm run dev`
2. Open http://localhost:3000 in two or more windows **side by side** (a
   normal window plus an incognito one works well; background tabs are
   throttled by the browser so put them next to each other).
3. Grab Claude in one window and throw him; watch the others. Grab him in a
   second window while he's flying. The live counter, "X grabbed Claude"
   tag, colored remote cursors and activity feed all update across windows.
4. Phone: the server prints a `network:` URL on startup. Open it on a phone
   on the same Wi-Fi.
5. No friends handy? Spawn bots that fight you for him:

   ```bash
   npm run bots              # 3 bots
   npm run bots -- 8         # 8 bots
   ```

## Test Daily Claude

Open http://localhost:3000/daily. Your first result each day is saved, so
to play again, open DevTools → Application → Local Storage and delete
`whip-claude:daily` (plus `whip-claude:daily-rules` to see the rules popup
again), or use an incognito window. These keys still use the old name on
purpose. Renaming them would reset everyone's streaks.

- Challenge link: http://localhost:3000/daily?r=3k-h1w2h0m3h2b3 (change the
  leading `3` to today's puzzle number, or the box won't show)
- Preview images: http://localhost:3000/opengraph-image,
  http://localhost:3000/daily/og and http://localhost:3000/daily/og?r=3k-h1w2h0m3h2b3

## Production

```bash
npm run build
npm start                    # PORT=3000 by default
```

Deploy anywhere that runs a long-lived Node process with WebSockets
(Railway, Render, Fly.io, a VPS). A `Dockerfile` is included. Serverless
platforms such as Vercel functions can't hold the WebSocket room. Run one
instance (on Railway, keep replicas at 1). The room, chat history and kill
record live in memory and reset on redeploy. Players' own daily streaks are
stored in their browsers and aren't affected.

### Daily stats database (Postgres)

Daily stats survive redeploys if the app has a Postgres database. Without
one, they fall back to memory.

1. On Railway, choose **+ New → Database → PostgreSQL**.
2. Open the **app** service (not the database), go to **Variables**, and add
   `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`. The Postgres service has its
   own `DATABASE_URL`, but your app can't see it until you reference it like
   this. If the app service already has `DATABASE_URL`, make sure it points at
   this database.
3. Redeploy. Then play a daily and check the Postgres **Data** tab for a
   `daily_results` table. Connection problems show up in the deploy logs as
   lines starting with `[daily]`. If the database is down, players just don't
   see the "you beat X%" line; the game still works.

The app creates the table itself on first use: one row per counted result
(day, browser id, IP, killed, moves, time). Only today's and yesterday's
puzzles are kept. Older rows are deleted automatically once a day, so the table
stays small and IPs aren't stored long-term.

How many people KO'd him in each number of moves on a puzzle (swap in the
puzzle number):

```sql
SELECT moves, count(*) FROM daily_results WHERE day = 3 AND killed GROUP BY moves ORDER BY moves;
```

To use a database locally, set `DATABASE_URL` before `npm run dev`, for
example `DATABASE_URL=postgres://localhost/happyclaude npm run dev`.

## Architecture

```
server/index.ts            Next.js + Socket.IO on one HTTP server
server/world.ts            the authoritative room: physics loop, ownership,
                           items, health, kill leaderboard, chat
server/stats.ts            kill record / counters (in memory; StatsStore interface
                           so it can move to a database later)
server/identity.ts         anonymous names/colors, coarse city from edge headers
lib/physics.ts             shared deterministic disc physics (server AND client),
                           with optional arena bounds, bumpers and tuning
lib/protocol.ts            wire types, HP/damage constants, sync design notes
lib/items.ts               item stats + shared knockback (multiplayer and daily)
lib/daily.ts               seeded daily puzzle generator, share text, run codes
lib/og.ts                  shared pieces for the link-preview images
lib/client/engine.ts       input, prediction, smoothing, rendering, presence;
                           also runs offline in "solo mode" for Daily Claude
lib/client/net.ts          socket + server clock estimation; OfflineNet for solo
lib/client/dailyStore.ts   daily results, streaks and stats in localStorage
lib/client/fx.ts           canvas particles / rings / item effects
lib/client/sound.ts        synthesized WebAudio sfx (muted by default)
lib/client/itemArt.ts      pixel-art item icons
app/page.tsx               the multiplayer room
app/opengraph-image.tsx    link-preview image for the main site
app/daily/page.tsx         Daily Claude (reads ?r= for challenges and previews)
app/daily/og/route.tsx     link-preview image for /daily, per shared run
app/api/daily/route.ts     global daily stats API (submit a result, read totals)
lib/server/dailyStats.ts   daily stats storage: Postgres, or memory without a DB
components/                React UI: mascot, HUD, daily card, health bar,
                           death screen, inventory, chat
components/daily/          Daily Claude game + results/share card
assets/fonts/              fonts for the preview images
scripts/bots.ts            fake players for load and feel testing
```

**Sync model**

- Clients send intent only: `grab` (server arbitrates; first processed wins),
  `drag` (pointer target at ~30 Hz), `release` (throw velocity from the last
  ~70 ms of pointer samples, validated and clamped server-side).
- The server simulates at 60 Hz (240 Hz substeps) and broadcasts snapshots
  at ~30 Hz while held, ~20 Hz in flight, ~1 Hz at rest. Ownership changes
  are reliable events carrying a full snapshot plus an `epoch` counter.
- Every client runs the same physics each frame. Incoming snapshots are
  fast-forwarded by measured latency; the difference from the local
  prediction becomes a visual offset that decays over ~100 ms.
- The holder drives their own screen with zero latency and ignores
  snapshots until the server confirms their release epoch.
- Disconnects, frozen tabs (2.5 s without input) and hogging (7 s while
  others are online) release Claude automatically. Waking a tab or
  reconnecting requests a fresh authoritative state.

**World mapping**: the world is a fixed 1600×1000 box. Each client maps
Claude's center range onto its own viewport, so he bounces off the edges of
*your* screen whatever its aspect ratio, and crossing time is identical for
everyone.

**Location**: "someone in New York" only appears when the host's edge adds a
city header (`x-vercel-ip-city`, `cf-ipcity`, `x-geo-city`); otherwise the
feed uses usernames. Browsers are never asked for location.
