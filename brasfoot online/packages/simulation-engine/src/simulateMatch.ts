import { createRng, hashStringToSeed } from "@brfut/shared-types";
import type { MatchResult, SimMatchEvent } from "@brfut/shared-types";
import type { TeamInput } from "./types.js";
import { calculateTeamStrength } from "./teamStrength.js";
import { calculatePossession } from "./possession.js";
import { expectedChances, sampleChanceCount, sampleChanceMinute } from "./chances.js";
import { resolveChance } from "./resolveChance.js";
import { generateDisciplineEvents } from "./discipline.js";
import { generateInjuryEvents } from "./injuries.js";
import { calculatePlayerRatings } from "./ratings.js";

export type { TeamInput, LineupPlayer, TeamStrength } from "./types.js";
export { calculateTeamStrength } from "./teamStrength.js";

/**
 * Simulates a full 90-minute match in one synchronous pass and returns the
 * complete, time-ordered event log. Deterministic: the same seed + inputs
 * always produce the same MatchResult (see Match.simulationSeed).
 *
 * This does NOT stream events in real time — that's the realtime gateway's
 * job, replaying this pre-computed log at the league's configured pace.
 */
export function simulateMatch(homeTeam: TeamInput, awayTeam: TeamInput, seed: string | number): MatchResult {
  const numericSeed = typeof seed === "string" ? hashStringToSeed(seed) : seed;
  const rng = createRng(numericSeed);

  const homeStrength = calculateTeamStrength(homeTeam);
  const awayStrength = calculateTeamStrength(awayTeam);
  const homePossession = calculatePossession(homeStrength, awayStrength);

  const homeLambda = expectedChances(homeStrength.attack, awayStrength.defense, homePossession);
  const awayLambda = expectedChances(awayStrength.attack, homeStrength.defense, 1 - homePossession);

  const homeChanceCount = sampleChanceCount(rng, homeLambda);
  const awayChanceCount = sampleChanceCount(rng, awayLambda);

  const events: SimMatchEvent[] = [
    { minute: 0, second: 0, type: "KICK_OFF", teamSide: "home" },
  ];

  for (let i = 0; i < homeChanceCount; i++) {
    events.push(resolveChance(rng, homeTeam, awayTeam, sampleChanceMinute(rng), "home"));
  }
  for (let i = 0; i < awayChanceCount; i++) {
    events.push(resolveChance(rng, awayTeam, homeTeam, sampleChanceMinute(rng), "away"));
  }

  events.push(...generateDisciplineEvents(rng, homeTeam, "home"));
  events.push(...generateDisciplineEvents(rng, awayTeam, "away"));
  events.push(...generateInjuryEvents(rng, homeTeam, "home"));
  events.push(...generateInjuryEvents(rng, awayTeam, "away"));

  events.push({ minute: 45, second: 0, type: "HALF_TIME", teamSide: "home" });
  events.push({ minute: 90, second: 0, type: "FULL_TIME", teamSide: "home" });

  events.sort((a, b) => a.minute - b.minute || a.second - b.second);

  let homeScore = 0;
  let awayScore = 0;
  for (const event of events) {
    const isGoal = event.type === "GOAL" || event.type === "PENALTY_GOAL";
    const isOwnGoal = event.type === "OWN_GOAL";
    if (isGoal && event.teamSide === "home") homeScore++;
    if (isGoal && event.teamSide === "away") awayScore++;
    // an own goal is logged against the team that committed it, so it credits the opponent
    if (isOwnGoal && event.teamSide === "home") awayScore++;
    if (isOwnGoal && event.teamSide === "away") homeScore++;
  }

  const playerRatings = calculatePlayerRatings(events, homeTeam, awayTeam);

  return { homeScore, awayScore, events, playerRatings };
}
