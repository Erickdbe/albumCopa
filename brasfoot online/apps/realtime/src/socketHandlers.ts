import type { Server, Socket } from "socket.io";
import { prisma } from "@brfut/db";
import type { JoinMatchRoomRequest, MatchSnapshotPayload } from "@brfut/shared-types";
import { getSnapshot, isBroadcastKnown } from "./matchBroadcaster.js";

async function buildFallbackSnapshot(matchId: string): Promise<MatchSnapshotPayload | null> {
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match) return null;

  // Match.status only ever moves SCHEDULED -> FINISHED (the worker sets it
  // directly; nothing currently sets "LIVE" in the DB — the realtime layer
  // tracks "is this actually airing" itself, in matchBroadcaster's map).
  // So a FINISHED match not yet in that map is just the brief race window
  // before the poller picks it up — treat it the same as SCHEDULED.
  return {
    matchId,
    homeScore: 0,
    awayScore: 0,
    elapsedMinute: 0,
    eventsSoFar: [],
    status: "SCHEDULED",
  };
}

export function registerSocketHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    socket.on("match:join", async ({ matchId }: JoinMatchRoomRequest) => {
      socket.join(`match:${matchId}`);
      socket.join(`match:${matchId}:score`);

      const snapshot = isBroadcastKnown(matchId) ? getSnapshot(matchId) : await buildFallbackSnapshot(matchId);

      if (!snapshot) {
        socket.emit("match:error", { matchId, message: "Match not found" });
        return;
      }

      socket.emit("match:snapshot", snapshot);
    });

    socket.on("match:leave", ({ matchId }: JoinMatchRoomRequest) => {
      socket.leave(`match:${matchId}`);
      socket.leave(`match:${matchId}:score`);
    });
  });
}
