import type { TeamStrength } from "./types.js";

const HOME_ADVANTAGE = 0.04;

/** Returns home team's possession share (0-1); away is 1 - result. */
export function calculatePossession(home: TeamStrength, away: TeamStrength): number {
  const raw = home.midfield / (home.midfield + away.midfield);
  return Math.min(0.75, Math.max(0.25, raw + HOME_ADVANTAGE));
}
