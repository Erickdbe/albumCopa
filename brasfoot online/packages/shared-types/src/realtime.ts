import type { SimMatchEvent } from "./match.js";

/** Emitted to a match room (`match:{id}`) as each event is replayed at the configured pace. */
export interface MatchEventPayload {
  matchId: string;
  event: SimMatchEvent;
}

/** Emitted on the lightweight score-only channel (`match:{id}:score`). */
export interface ScoreUpdatePayload {
  matchId: string;
  homeScore: number;
  awayScore: number;
  minute: number;
}

/** Sent once to a client that joins a room mid-match, to catch it up before live events resume. */
export interface MatchSnapshotPayload {
  matchId: string;
  homeScore: number;
  awayScore: number;
  elapsedMinute: number;
  eventsSoFar: SimMatchEvent[];
  status: "SCHEDULED" | "LIVE" | "FINISHED";
}

export interface JoinMatchRoomRequest {
  matchId: string;
}
