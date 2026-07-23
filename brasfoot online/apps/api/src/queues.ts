import { Queue } from "bullmq";
import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const queueConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const simulateMatchQueue = new Queue("simulate-match", {
  connection: queueConnection,
});

export async function closeQueues() {
  await simulateMatchQueue.close();
  await queueConnection.quit();
}
