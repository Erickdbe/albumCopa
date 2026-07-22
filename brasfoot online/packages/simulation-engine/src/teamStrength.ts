import type { TacticStyle } from "@brfut/shared-types";
import type { LineupPlayer, TeamInput, TeamStrength } from "./types.js";

const ATTACKING_POSITIONS = new Set(["AM", "LW", "RW", "ST"]);
const MIDFIELD_POSITIONS = new Set(["DM", "CM", "AM"]);
const DEFENSIVE_POSITIONS = new Set(["CB", "LB", "RB"]);

function average(values: number[]): number {
  if (values.length === 0) return 50;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function conditionMultiplier(players: LineupPlayer[]): number {
  const avgMorale = average(players.map((p) => p.morale));
  const avgFitness = average(players.map((p) => p.fitness));
  const condition = avgMorale * 0.4 + avgFitness * 0.6;
  // condition 0-100 maps to a 0.7x-1.15x multiplier — tired/demoralized teams
  // underperform their raw attributes, but never collapse to zero.
  return 0.7 + (condition / 100) * 0.45;
}

function mentalityModifiers(mentality: TacticStyle["mentality"]): { attack: number; defense: number } {
  switch (mentality) {
    case "offensive":
      return { attack: 1.15, defense: 0.9 };
    case "defensive":
      return { attack: 0.85, defense: 1.15 };
    default:
      return { attack: 1.0, defense: 1.0 };
  }
}

export function calculateTeamStrength(team: TeamInput): TeamStrength {
  const attackers = team.players.filter((p) => ATTACKING_POSITIONS.has(p.position));
  const midfielders = team.players.filter((p) => MIDFIELD_POSITIONS.has(p.position));
  const defenders = team.players.filter((p) => DEFENSIVE_POSITIONS.has(p.position));
  const keeper = team.players.find((p) => p.position === "GK");

  const rawAttack = average(
    attackers.flatMap((p) => [p.attributes.finishing, p.attributes.passing, p.attributes.dribbling])
  );
  const rawMidfield = average(
    midfielders.flatMap((p) => [p.attributes.passing, p.attributes.stamina, p.attributes.tackling])
  );
  const rawDefense = average(
    defenders.flatMap((p) => [p.attributes.tackling, p.attributes.strength])
  );
  const rawGoalkeeping = keeper
    ? (keeper.attributes.gkReflexes + keeper.attributes.gkPositioning) / 2
    : 40;

  const { attack: attackMod, defense: defenseMod } = mentalityModifiers(team.tactic.mentality);
  const condition = conditionMultiplier(team.players);

  return {
    attack: rawAttack * attackMod * condition,
    midfield: rawMidfield * condition,
    defense: rawDefense * defenseMod * condition,
    goalkeeping: rawGoalkeeping * condition,
  };
}
