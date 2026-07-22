import type { SimMatchEvent } from "@brfut/shared-types";
import type { TeamInput } from "./types.js";

const BASE_RATING = 6.0;

const RATING_DELTA: Partial<Record<SimMatchEvent["type"], number>> = {
  GOAL: 0.9,
  PENALTY_GOAL: 0.7,
  OWN_GOAL: -0.8,
  YELLOW_CARD: -0.3,
  RED_CARD: -1.0,
  PENALTY_MISSED: -0.5,
};

const ASSIST_DELTA = 0.4;

export function calculatePlayerRatings(
  events: SimMatchEvent[],
  homeTeam: TeamInput,
  awayTeam: TeamInput
): Record<string, number> {
  const ratings = new Map<string, number>();
  for (const player of [...homeTeam.players, ...awayTeam.players]) {
    ratings.set(player.id, BASE_RATING);
  }

  for (const event of events) {
    const delta = RATING_DELTA[event.type];
    if (delta && event.playerId && ratings.has(event.playerId)) {
      ratings.set(event.playerId, ratings.get(event.playerId)! + delta);
    }
    if ((event.type === "GOAL" || event.type === "PENALTY_GOAL") && event.relatedPlayerId) {
      if (ratings.has(event.relatedPlayerId)) {
        ratings.set(event.relatedPlayerId, ratings.get(event.relatedPlayerId)! + ASSIST_DELTA);
      }
    }
  }

  const result: Record<string, number> = {};
  for (const [playerId, rating] of ratings) {
    result[playerId] = Math.round(Math.max(4.0, Math.min(10.0, rating)) * 10) / 10;
  }
  return result;
}
