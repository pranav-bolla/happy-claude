/**
 * Spawns fake players that connect over real sockets and periodically grab,
 * swing and throw Claude. Handy for testing the multiplayer feel alone.
 *
 *   npm run bots            # 3 bots against http://localhost:3000
 *   npm run bots -- 6 http://localhost:3000
 */
import { io } from "socket.io-client";
import { RADIUS, WORLD_H, WORLD_W } from "../lib/physics";
import { ITEMS, type ItemId } from "../lib/items";
import { SOCKET_PATH, type GrabResult, type Snapshot, type UsedEvent, type Welcome } from "../lib/protocol";

const count = Number(process.argv[2]) || 3;
const url = process.argv[3] || "http://localhost:3000";

function bot(n: number) {
  const s = io(url, { path: SOCKET_PATH, transports: ["websocket"] });
  let world: Snapshot | null = null;
  let name = `bot${n}`;

  s.on("welcome", (w: Welcome) => {
    name = w.you.name;
    world = w.world;
    console.log(`[${name}] joined (${w.players} online)`);
  });
  s.on("s", (snap: Snapshot) => (world = snap));
  s.on("grabbed", (e: { world: Snapshot }) => (world = e.world));
  s.on("released", (e: { world: Snapshot }) => (world = e.world));
  s.on("used", (e: UsedEvent) => {
    if (e.world) world = e.world;
    if (n === 0) console.log(`  ⚔ ${e.who.name} ${e.item} ${e.phase}${e.damage ? ` -${e.damage}` : ""}`);
  });
  s.on("hype", (h: { text: string }) => console.log(`  ★ ${h.text}`));
  s.on("feed", (f: { text: string }) => console.log(`  · ${f.text}`));
  s.on("round", (r: { alive: boolean; killMs: number | null; record: boolean; killer: { name: string } | null }) => {
    if (r.alive) return;
    if (n === 0) {
      console.log(`  ☠ killed in ${(r.killMs! / 1000).toFixed(1)}s by ${r.killer?.name ?? "the wall"}${r.record ? " (RECORD)" : ""}`);
    }
    setTimeout(() => s.emit("revive"), 3000 + Math.random() * 2000);
  });

  const attempt = () => {
    setTimeout(attempt, 1500 + Math.random() * 4000);
    const w = world;
    if (!w || w.g) return;
    const age = (Date.now() - w.t) / 1000;
    const x = w.x + w.vx * age;
    const y = w.y + w.vy * age;
    s.emit(
      "grab",
      { x, y, px: x, py: y, ox: 0, oy: 0, rx: RADIUS, ry: RADIUS },
      (res: GrabResult) => {
        if (!res.ok) return;
        // swing in a circle for a bit, then fling
        let t = 0;
        const cx = x;
        const cy = y;
        const swing = setInterval(() => {
          t += 0.033;
          const ang = t * 9;
          const tx = Math.min(Math.max(cx + Math.cos(ang) * 120, RADIUS), WORLD_W - RADIUS);
          const ty = Math.min(Math.max(cy + Math.sin(ang) * 120, RADIUS), WORLD_H - RADIUS);
          s.emit("drag", { x: tx, y: ty, vx: -Math.sin(ang) * 1080, vy: Math.cos(ang) * 1080 });
          if (t > 0.6 + Math.random() * 0.6) {
            clearInterval(swing);
            const a = Math.random() * Math.PI * 2;
            const sp = 900 + Math.random() * 3600;
            s.emit("release", {
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              av: (Math.random() - 0.5) * 20,
              bx: NaN,
              by: NaN,
              ba: NaN,
              t: Date.now(),
            });
            console.log(`[${name}] whipped Claude at ${Math.round(sp)} px/s`);
          }
        }, 33);
      },
    );
  };
  setTimeout(attempt, 800 + n * 700);

  // and sometimes hit him with something from the inventory
  const tools: ItemId[] = ["whip", "whip", "hammer", "taser", "bomb"];
  const smack = () => {
    setTimeout(smack, 1200 + Math.random() * 2500);
    const w = world;
    if (!w || w.g) return;
    const item = tools[Math.floor(Math.random() * tools.length)];
    const age = (Date.now() - w.t) / 1000;
    const a = Math.random() * Math.PI * 2;
    const d = RADIUS * ITEMS[item].reach * 0.6;
    s.emit("use", { item, x: w.x + w.vx * age + Math.cos(a) * d, y: w.y + w.vy * age + Math.sin(a) * d });
  };
  setTimeout(smack, 1500 + n * 500);
}

for (let i = 0; i < count; i++) bot(i);
