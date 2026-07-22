import type { Server } from "socket.io";
import type { MatchSnapshotPayload, MatchEventPayload, ScoreUpdatePayload, SimMatchEvent } from "@brfut/shared-types";
import { readMatchStream } from "./streamReader.js";

const SCORE_CHANGING_TYPES = new Set(["GOAL", "PENALTY_GOAL", "OWN_GOAL"]);

interface EventWithScore {
  event: SimMatchEvent;
  homeScoreAfter: number;
  awayScoreAfter: number;
}

interface BroadcastState {
  matchId: string;
  startedAt: number;
  playbackSecondsPerMinute: number;
  timeline: EventWithScore[];
  status: "LIVE" | "FINISHED";
}

// In-memory only: fine for a single realtime instance. Running multiple
// gateway instances would need this moved to Redis (e.g. a per-match lock)
// so only one instance drives playback while all instances still fan out
// the resulting io.to(room).emit() via the Redis adapter — next iteration.
const activeBroadcasts = new Map<string, BroadcastState>();

function buildTimeline(events: SimMatchEvent[]): EventWithScore[] {
  const sorted = [...events].sort((a, b) => a.minute - b.minute || a.second - b.second);
  let homeScore = 0;
  let awayScore = 0;

  return sorted.map((event) => {
    if (event.type === "GOAL" || event.type === "PENALTY_GOAL") {
      if (event.teamSide === "home") homeScore++;
      else awayScore++;
    } else if (event.type === "OWN_GOAL") {
      if (event.teamSide === "home") awayScore++;
      else homeScore++;
    }
    return { event, homeScoreAfter: homeScore, awayScoreAfter: awayScore };
  });
}

function delayForEvent(event: SimMatchEvent, playbackSecondsPerMinute: number): number {
  return (event.minute + event.second / 60) * playbackSecondsPerMinute * 1000;
}

export async function startBroadcast(io: Server, matchId: string, playbackSecondsPerMinute: number): Promise<void> {
  if (activeBroadcasts.has(matchId)) return; // already broadcasting or done

  const { events } = await readMatchStream(matchId);
  const timeline = buildTimeline(events);

  const state: BroadcastState = {
    matchId,
    startedAt: Date.now(),
    playbackSecondsPerMinute,
    timeline,
    status: "LIVE",
  };
  activeBroadcasts.set(matchId, state);

  const room = `match:${matchId}`;
  const scoreRoom = `match:${matchId}:score`;

  for (const entry of timeline) {
    const delay = delayForEvent(entry.event, playbackSecondsPerMinute);
    setTimeout(() => {
      const payload: MatchEventPayload = { matchId, event: entry.event };
      io.to(room).emit("match:event", payload);

      if (SCORE_CHANGING_TYPES.has(entry.event.type)) {
        const scorePayload: ScoreUpdatePayload = {
          matchId,
          homeScore: entry.homeScoreAfter,
          awayScore: entry.awayScoreAfter,
          minute: entry.event.minute,
        };
        io.to(scoreRoom).emit("match:score", scorePayload);
      }
    }, delay);
  }

  const totalDuration = 90 * playbackSecondsPerMinute * 1000 + 2000;
  setTimeout(() => {
    state.status = "FINISHED";
  }, totalDuration);
}

export function getSnapshot(matchId: string): MatchSnapshotPayload | null {
  const state = activeBroadcasts.get(matchId);
  if (!state) return null;

  const elapsedMinute =
    state.status === "FINISHED"
      ? 90
      : (Date.now() - state.startedAt) / 1000 / state.playbackSecondsPerMinute;

  const eventsSoFar = state.timeline.filter((entry) => entry.event.minute <= elapsedMinute).map((e) => e.event);
  const last = [...state.timeline].reverse().find((entry) => entry.event.minute <= elapsedMinute);

  return {
    matchId,
    homeScore: last?.homeScoreAfter ?? 0,
    awayScore: last?.awayScoreAfter ?? 0,
    elapsedMinute: Math.min(90, Math.floor(elapsedMinute)),
    eventsSoFar,
    status: state.status,
  };
}

export function isBroadcastKnown(matchId: string): boolean {
  return activeBroadcasts.has(matchId);
}
