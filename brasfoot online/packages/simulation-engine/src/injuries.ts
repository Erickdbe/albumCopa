import type { SimMatchEvent, TeamSide } from "@brfut/shared-types";
import type { TeamInput } from "./types.js";
import { samplePoisson } from "./poisson.js";
import { weightedPick } from "./weightedPick.js";

/** Baseline ~0.15 injuries/team/match, rising as squad fitness drops. */
export function generateInjuryEvents(rng: () => number, team: TeamInput, teamSide: TeamSide): SimMatchEvent[] {
  const avgFitness = team.players.reduce((sum, p) => sum + p.fitness, 0) / team.players.length;
  const lambda = 0.15 + Math.max(0, (70 - avgFitness) / 100);
  const count = samplePoisson(rng, lambda);

  const events: SimMatchEvent[] = [];
  for (let i = 0; i < count; i++) {
    const player = weightedPick(rng, team.players, (p) => Math.max(1, 100 - p.fitness));
    events.push({
      minute: Math.floor(rng() * 90) + 1,
      second: Math.floor(rng() * 60),
      type: "INJURY",
      teamSide,
      playerId: player.id,
    });
  }
  return events;
}
