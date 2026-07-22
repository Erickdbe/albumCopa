import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { prisma } from "@brfut/db";
import { assertProductionConfig } from "./assertProductionConfig.js";
import { leaguesRouter } from "./routes/leagues.js";
import { matchesRouter } from "./routes/matches.js";
import { clubsRouter } from "./routes/clubs.js";
import { marketRouter } from "./routes/market.js";
import { authRouter } from "./routes/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { apiRateLimit } from "./middleware/apiRateLimit.js";

assertProductionConfig();

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());

app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Applied after /health so orchestrator health checks (which poll
// frequently) never get rate-limited.
app.use(apiRateLimit);

app.use("/auth", authRouter);
app.use("/leagues", leaguesRouter);
app.use("/matches", matchesRouter);
app.use("/clubs", clubsRouter);
app.use("/market", marketRouter);

// Must be registered last — Express recognizes it as an error handler by
// its 4-argument signature.
app.use(errorHandler);

const PORT = Number(process.env.PORT ?? 4000);
const server = app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
});

// Orchestrators (Docker, k8s, etc.) send SIGTERM before killing a
// container — stop accepting new connections, let in-flight requests
// finish, then close the DB connection, instead of dropping requests mid-
// flight on a hard kill.
async function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal}, closing gracefully...`);
  server.close(async () => {
    await prisma.$disconnect();
    console.log("[shutdown] closed");
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
