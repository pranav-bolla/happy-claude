# WHIP CLAUDE

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
attempt each day counts. Afterwards you get an emoji share grid (one square per
move, colored by damage), your streak, a moves histogram, and how you compare with
everyone else who played today.

- The puzzle is built in `lib/daily.ts`. A seeded RNG turns the day number
  into the spec, so every player gets the same puzzle without a server.
- The game runs entirely in the browser: `Engine` in solo mode with the
  same physics and items as multiplayer.
- Results and streaks are kept in localStorage (`lib/client/dailyStore.ts`).
- Global "you beat X%" stats come from `/api/daily`, held in memory
  with one result per IP per day. They reset when the server restarts.

The main page shows a **DAILY #N** button next to the title. It pulses until
you've played today's puzzle.

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
again), or use an incognito window.

## Production

```bash
npm run build
npm start                    # PORT=3000 by default
```

Deploy anywhere that runs a long-lived Node process with WebSockets
(Railway, Render, Fly.io, a VPS). A `Dockerfile` is included. Serverless
platforms such as Vercel functions can't hold the WebSocket room. Run one
instance (on Railway, keep replicas at 1). The room, chat history, kill
record and daily stats all live in memory and reset on redeploy. Players'
own daily streaks are stored in their browsers and aren't affected.

## Architecture

```
server/index.ts            Next.js + Socket.IO on one HTTP server
server/world.ts            the authoritative room: physics loop, ownership,
                           items, health, kill leaderboard, chat
server/stats.ts            StatsStore interface (in-memory now; swap for Redis/DB)
server/identity.ts         anonymous names/colors, coarse city from edge headers
lib/physics.ts             shared deterministic disc physics (server AND client),
                           with optional arena bounds, bumpers and tuning
lib/protocol.ts            wire types, HP/damage constants, sync design notes
lib/items.ts               item stats + shared knockback (multiplayer and daily)
lib/daily.ts               seeded daily puzzle generator + share text
lib/client/engine.ts       input, prediction, smoothing, rendering, presence;
                           also runs offline in "solo mode" for Daily Claude
lib/client/net.ts          socket + server clock estimation; OfflineNet for solo
lib/client/dailyStore.ts   daily results, streaks and stats in localStorage
lib/client/fx.ts           canvas particles / rings / item effects
lib/client/sound.ts        synthesized WebAudio sfx (muted by default)
lib/client/itemArt.ts      pixel-art item icons
app/page.tsx               the multiplayer room
app/daily/page.tsx         Daily Claude
app/api/daily/route.ts     global daily stats (in memory)
components/                React UI: mascot, HUD, health bar, death screen,
                           inventory, chat
components/daily/          Daily Claude game + results/share card
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
