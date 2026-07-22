import type { PlayerAttributes, PlayerPosition } from "./player.js";

/**
 * Which attributes count toward a player's overall, per position. Single
 * source of truth shared by player generation (football-data-adapter) and
 * post-match evolution (worker) — both need to (re)compute overall from
 * attributes the same way, or the two would drift out of sync.
 */
export const OVERALL_SPECIALTY_ATTRIBUTES: Record<PlayerPosition, (keyof PlayerAttributes)[]> = {
  GK: ["gkReflexes", "gkPositioning", "strength", "passing"],
  CB: ["tackling", "strength", "passing", "pace"],
  LB: ["tackling", "pace", "passing", "stamina"],
  RB: ["tackling", "pace", "passing", "stamina"],
  DM: ["tackling", "passing", "stamina", "strength"],
  CM: ["passing", "stamina", "dribbling", "tackling"],
  AM: ["passing", "dribbling", "finishing", "pace"],
  LW: ["pace", "dribbling", "finishing"],
  RW: ["pace", "dribbling", "finishing"],
  ST: ["finishing", "pace", "strength", "dribbling"],
};

export function calculateOverall(position: PlayerPosition, attributes: PlayerAttributes): number {
  const keys = OVERALL_SPECIALTY_ATTRIBUTES[position];
  return Math.round(keys.reduce((sum, key) => sum + attributes[key], 0) / keys.length);
}
