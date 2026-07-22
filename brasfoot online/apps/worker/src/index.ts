import "dotenv/config";
import { Worker } from "bullmq";
import { prisma } from "@brfut/db";
import { connection } from "./redis.js";
import { runSimulateMatchJob } from "./jobs/simulateMatch.js";
import { startMarketResolver } from "./marketResolver.js";

const simulateMatchWorker = new Worker(
  "simulate-match",
  async (job) => {
    const { matchId } = job.data as { matchId: string };
    return runSimulateMatchJob(matchId);
  },
  { connection }
);

simulateMatchWorker.on("completed", (job) => {
  console.log(`[simulate-match] completed job ${job.id} (match ${job.data.matchId})`);
});
simulateMatchWorker.on("failed", (job, err) => {
  console.error(`[simulate-match] failed job ${job?.id}:`, err.message);
});

const bullmqWorkers = [simulateMatchWorker];

// "process-transfer" is reserved for the direct offer/negotiation flow
// (point-to-point proposal, accept/reject) — not built yet. The auction
// side of the market (listings + bids) is handled by startMarketResolver()
// below instead, since expiry is a time sweep, not a discrete job.
const stubQueueNames = ["process-transfer", "recalculate-standings", "update-market-values"];
for (const queueName of stubQueueNames) {
  const stubWorker = new Worker(
    queueName,
    async (job) => {
      console.log(`[${queueName}] received job ${job.id} — no processor implemented yet (next iteration)`);
    },
    { connection }
  );
  stubWorker.on("failed", (job, err) => console.error(`[${queueName}] failed job ${job?.id}:`, err.message));
  bullmqWorkers.push(stubWorker);
}

const marketResolverInterval = startMarketResolver();

console.log(
  `Worker process started. Listening on: simulate-match, market-resolver (active), ${stubQueueNames.join(", ")} (stubs)`
);

// BullMQ's Worker.close() finishes any in-flight job before stopping, so a
// deploy/restart doesn't cut a match simulation off mid-way.
async function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal}, closing gracefully...`);
  clearInterval(marketResolverInterval);
  await Promise.all(bullmqWorkers.map((worker) => worker.close()));
  await connection.quit();
  await prisma.$disconnect();
  console.log("[shutdown] closed");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
