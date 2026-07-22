import type { Server } from "socket.io";
import { prisma } from "@brfut/db";
import { startBroadcast, isBroadcastKnown } from "./matchBroadcaster.js";

const POLL_INTERVAL_MS = 3000;

/**
 * Picks up matches the worker just finished simulating and starts replaying
 * them to spectators. This is the seam between "simulation already happened"
 * and "live broadcast" — the gateway never simulates anything itself.
 */
export function startMatchPoller(io: Server): NodeJS.Timeout {
  return setInterval(async () => {
    const recentlyFinished = await prisma.match.findMany({
      where: { status: "FINISHED" },
      orderBy: { scheduledAt: "desc" },
      take: 50,
      include: { season: { include: { league: true } } },
    });

    for (const match of recentlyFinished) {
      if (isBroadcastKnown(match.id)) continue;
      const playbackSecondsPerMinute = match.season.league.playbackSecondsPerMinute;
      await startBroadcast(io, match.id, playbackSecondsPerMinute);
      console.log(`[poller] started broadcast for match ${match.id} at ${playbackSecondsPerMinute}s/min`);
    }
  }, POLL_INTERVAL_MS);
}
