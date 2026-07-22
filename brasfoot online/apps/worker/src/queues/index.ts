import { Queue } from "bullmq";
import { connection } from "../redis.js";

export const simulateMatchQueue = new Queue("simulate-match", { connection });

// Reserved for the next iteration (transfer negotiation, table recompute
// triggers, market revaluation) — no processor is wired up for these yet.
export const processTransferQueue = new Queue("process-transfer", { connection });
export const recalculateStandingsQueue = new Queue("recalculate-standings", { connection });
export const updateMarketValuesQueue = new Queue("update-market-values", { connection });
