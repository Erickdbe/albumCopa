import "dotenv/config";
import { Queue } from "bullmq";
import { prisma } from "@brfut/db";
import { connection } from "../redis.js";

/**
 * Enqueues the oldest SCHEDULED match for simulation. Verification helper —
 * run after `npm run db:seed` to prove the worker pipeline end-to-end
 * without needing the API's future "start round" endpoint.
 *
 * Uses its own Queue instance (not queues/index.ts) so this one-shot script
 * only opens the one Redis connection it needs and can exit cleanly,
 * instead of inheriting the worker's other three long-lived queues.
 */
async function main() {
  const match = await prisma.match.findFirst({
    where: { status: "SCHEDULED" },
    orderBy: { scheduledAt: "asc" },
  });

  if (!match) {
    console.log("No SCHEDULED match found. Run `npm run db:seed` first.");
    process.exit(1);
  }

  const simulateMatchQueue = new Queue("simulate-match", { connection });
  const job = await simulateMatchQueue.add("simulate-match", { matchId: match.id });
  console.log(`Enqueued match ${match.id} as job ${job.id}. Make sure the worker (npm run dev:worker) is running.`);
  await prisma.$disconnect();
  await simulateMatchQueue.close();
  connection.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
