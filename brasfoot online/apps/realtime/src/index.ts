import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { prisma } from "@brfut/db";
import { pubClient, subClient, dataClient } from "./redis.js";
import { registerSocketHandlers } from "./socketHandlers.js";
import { startMatchPoller } from "./poller.js";

const PORT = Number(process.env.PORT ?? 4001);

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins },
  adapter: createAdapter(pubClient, subClient),
});

registerSocketHandlers(io);
const pollerInterval = startMatchPoller(io);

httpServer.listen(PORT, () => {
  console.log(`Realtime gateway listening on :${PORT}`);
});

async function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal}, closing gracefully...`);
  clearInterval(pollerInterval);
  io.close();
  await Promise.all([pubClient.quit(), subClient.quit(), dataClient.quit()]);
  await prisma.$disconnect();
  console.log("[shutdown] closed");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
