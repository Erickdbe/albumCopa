import type { SimMatchEvent, TeamSide } from "@brfut/shared-types";
import type { LineupPlayer, TeamInput } from "./types.js";
import { weightedPick } from "./weightedPick.js";

const PENALTY_CHANCE = 0.06;
const OWN_GOAL_CHANCE = 0.015;
const ASSIST_CHANCE = 0.7;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function resolveChance(
  rng: () => number,
  attackingTeam: TeamInput,
  defendingTeam: TeamInput,
  minute: number,
  teamSide: TeamSide
): SimMatchEvent {
  const shooterPool = attackingTeam.players.filter((p) => p.position !== "GK");
  const shooter = weightedPick(rng, shooterPool, (p) => p.attributes.finishing ** 1.5);
  const keeper = defendingTeam.players.find((p) => p.position === "GK");
  const keeperSkill = keeper ? (keeper.attributes.gkReflexes + keeper.attributes.gkPositioning) / 2 : 40;

  const isPenalty = rng() < PENALTY_CHANCE;
  const isOwnGoal = !isPenalty && rng() < OWN_GOAL_CHANCE;

  if (isOwnGoal) {
    const defender = weightedPick(rng, defendingTeam.players, (p) => (p.position === "GK" ? 0.1 : 1));
    return {
      minute,
      second: Math.floor(rng() * 60),
      type: "OWN_GOAL",
      teamSide: teamSide === "home" ? "away" : "home",
      playerId: defender.id,
      metadata: { unluckyDefender: true },
    };
  }

  const skillDiff = shooter.attributes.finishing - keeperSkill;
  const baseProbability = isPenalty ? 0.76 : 0.28;
  const skillSwing = isPenalty ? skillDiff / 600 : skillDiff / 260;
  const pGoal = clamp(baseProbability + skillSwing, isPenalty ? 0.45 : 0.06, isPenalty ? 0.93 : 0.55);

  const scored = rng() < pGoal;
  const second = Math.floor(rng() * 60);

  if (!scored) {
    return {
      minute,
      second,
      type: isPenalty ? "PENALTY_MISSED" : "CHANCE_MISSED",
      teamSide,
      playerId: shooter.id,
    };
  }

  let assistPlayer: LineupPlayer | undefined;
  if (!isPenalty && rng() < ASSIST_CHANCE) {
    const assistPool = attackingTeam.players.filter((p) => p.id !== shooter.id && p.position !== "GK");
    if (assistPool.length > 0) {
      assistPlayer = weightedPick(rng, assistPool, (p) => p.attributes.passing ** 1.2);
    }
  }

  return {
    minute,
    second,
    type: isPenalty ? "PENALTY_GOAL" : "GOAL",
    teamSide,
    playerId: shooter.id,
    relatedPlayerId: assistPlayer?.id,
  };
}
