import type { SimMatchEvent, TeamSide } from "@brfut/shared-types";
import type { TeamInput } from "./types.js";
import { samplePoisson } from "./poisson.js";
import { weightedPick } from "./weightedPick.js";

const STRAIGHT_RED_CHANCE = 0.03;

export function generateDisciplineEvents(
  rng: () => number,
  team: TeamInput,
  teamSide: TeamSide
): SimMatchEvent[] {
  const events: SimMatchEvent[] = [];
  const yellowsByPlayer = new Map<string, number>();

  const lambdaYellow = 1.3 + (team.tactic.pressing / 100) * 1.4;
  const yellowCount = samplePoisson(rng, lambdaYellow);

  for (let i = 0; i < yellowCount; i++) {
    const player = weightedPick(rng, team.players, (p) => p.attributes.tackling);
    const minute = Math.floor(rng() * 90) + 1;
    const priorYellows = yellowsByPlayer.get(player.id) ?? 0;

    if (priorYellows >= 1) {
      events.push({
        minute,
        second: Math.floor(rng() * 60),
        type: "RED_CARD",
        teamSide,
        playerId: player.id,
        metadata: { secondYellow: true },
      });
    } else {
      yellowsByPlayer.set(player.id, priorYellows + 1);
      events.push({
        minute,
        second: Math.floor(rng() * 60),
        type: "YELLOW_CARD",
        teamSide,
        playerId: player.id,
      });
    }
  }

  if (rng() < STRAIGHT_RED_CHANCE) {
    const eligible = team.players.filter((p) => (yellowsByPlayer.get(p.id) ?? 0) === 0);
    if (eligible.length > 0) {
      const player = weightedPick(rng, eligible, (p) => p.attributes.tackling);
      events.push({
        minute: Math.floor(rng() * 90) + 1,
        second: Math.floor(rng() * 60),
        type: "RED_CARD",
        teamSide,
        playerId: player.id,
        metadata: { straightRed: true },
      });
    }
  }

  return events;
}
