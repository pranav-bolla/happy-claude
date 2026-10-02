/**
 * Single-process server: Next.js (pages + assets) and Socket.IO (the shared
 * room) on the same port. One `npm start` deploys anywhere that runs a
 * long-lived Node process with WebSockets (Railway, Render, Fly.io, a VPS...).
 */
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import next from "next";
import { Server } from "socket.io";
import { SOCKET_PATH } from "../lib/protocol";
import { MemoryStatsStore, type StatsStore } from "./stats";
import { World } from "./world";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOST || "0.0.0.0";

async function main() {
  const app = next({ dev, hostname: "localhost", port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const nextUpgrade = app.getUpgradeHandler();

  const httpServer = createServer((req, res) => handle(req, res));

  const io = new Server(httpServer, {
    path: SOCKET_PATH,
    transports: ["websocket", "polling"],
    pingInterval: 10000,
    pingTimeout: 8000,
    // let Next's dev HMR websocket share the server
    destroyUpgrade: false,
    cors: dev ? { origin: true } : undefined,
  });

  httpServer.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith(SOCKET_PATH)) nextUpgrade(req, socket, head);
  });

  const stats: StatsStore = new MemoryStatsStore();
  const world = new World(io, stats);
  io.on("connection", (socket) => world.onConnection(socket));
  world.start();

  httpServer.listen(port, hostname, () => {
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i!.address)
      .find((a) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a));
    console.log(`\n  🟠 WHIP CLAUDE is live`);
    console.log(`     local:   http://localhost:${port}`);
    if (lan) console.log(`     network: http://${lan}:${port}  (open on your phone)`);
    console.log("");
  });

  const shutdown = async () => {
    world.stop();
    await stats.flush?.();
    io.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
