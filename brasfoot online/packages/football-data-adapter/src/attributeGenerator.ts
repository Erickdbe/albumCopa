import { calculateOverall, createRng, hashStringToSeed, randomInRange } from "@brfut/shared-types";
import type { GeneratedPlayer, PlayerAttributes, PlayerPosition, PreferredFoot } from "@brfut/shared-types";

/**
 * football-data.org (and every other public football API we've looked at)
 * only exposes player identity — name, position label, nationality, DOB.
 * None expose FIFA-style 1-99 gameplay ratings, so we generate them here:
 * deterministically (same externalRef + club reputation always yields the
 * same player) but with enough spread to feel varied across a squad.
 */

const POSITION_LABEL_MAP: Record<string, PlayerPosition> = {
  Goalkeeper: "GK",
  "Centre-Back": "CB",
  "Left-Back": "LB",
  "Right-Back": "RB",
  Defender: "CB",
  "Defensive Midfield": "DM",
  "Central Midfield": "CM",
  Midfielder: "CM",
  "Attacking Midfield": "AM",
  "Left Winger": "LW",
  "Right Winger": "RW",
  "Left Midfield": "LW",
  "Right Midfield": "RW",
  "Centre-Forward": "ST",
  Striker: "ST",
  Forward: "ST",
  Offence: "ST",
};

export function mapRawPositionLabel(label: string | null | undefined): PlayerPosition {
  if (!label) return "CM";
  return POSITION_LABEL_MAP[label] ?? "CM";
}

// Baseline (min, max) per attribute per position — everyone gets some
// competence outside their specialty, but specialty attributes run higher.
const POSITION_BASELINES: Record<PlayerPosition, Partial<Record<keyof PlayerAttributes, [number, number]>>> = {
  GK: { gkReflexes: [55, 90], gkPositioning: [55, 90], strength: [40, 70], passing: [30, 55] },
  CB: { tackling: [55, 88], strength: [55, 88], passing: [35, 65], pace: [35, 65] },
  LB: { tackling: [50, 80], pace: [50, 82], passing: [40, 68], stamina: [55, 85] },
  RB: { tackling: [50, 80], pace: [50, 82], passing: [40, 68], stamina: [55, 85] },
  DM: { tackling: [55, 85], passing: [45, 75], stamina: [55, 85], strength: [45, 75] },
  CM: { passing: [55, 85], stamina: [55, 85], dribbling: [40, 70], tackling: [35, 65] },
  AM: { passing: [55, 88], dribbling: [50, 82], finishing: [40, 70], pace: [40, 70] },
  LW: { pace: [55, 90], dribbling: [55, 88], finishing: [40, 72] },
  RW: { pace: [55, 90], dribbling: [55, 88], finishing: [40, 72] },
  ST: { finishing: [55, 90], pace: [45, 82], strength: [40, 72], dribbling: [40, 72] },
};

const ATTRIBUTE_KEYS: (keyof PlayerAttributes)[] = [
  "pace",
  "finishing",
  "passing",
  "dribbling",
  "tackling",
  "strength",
  "stamina",
  "gkReflexes",
  "gkPositioning",
];

function ageFromBirthDate(birthDate: string): number {
  const dob = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

export interface GeneratePlayerInput {
  externalRef: string;
  name: string;
  birthDate: string;
  nationality: string;
  rawPositionLabel: string | null;
  /** 0-100, e.g. Club.reputation — shifts the baseline for the whole squad. */
  clubReputation: number;
}

export function generatePlayer(input: GeneratePlayerInput): GeneratedPlayer {
  const position = mapRawPositionLabel(input.rawPositionLabel);
  const seed = hashStringToSeed(`${input.externalRef}:${input.clubReputation}`);
  const rng = createRng(seed);

  const reputationShift = Math.round((input.clubReputation - 50) / 5); // roughly -10..+10
  const baselines = POSITION_BASELINES[position];

  const attributes = {} as PlayerAttributes;
  for (const key of ATTRIBUTE_KEYS) {
    const [min, max] = baselines[key] ?? [25, 55];
    const value = randomInRange(rng, min, max) + reputationShift;
    attributes[key] = Math.max(1, Math.min(99, value));
  }

  const overall = calculateOverall(position, attributes);

  const age = ageFromBirthDate(input.birthDate);
  // Younger players get more headroom above their current overall; peak ~27.
  const agePotentialBonus = age < 27 ? randomInRange(rng, 0, Math.max(0, 27 - age) * 2) : 0;
  const potential = Math.min(99, overall + agePotentialBonus);

  const preferredFoot: PreferredFoot = (["LEFT", "RIGHT", "BOTH"] as const)[randomInRange(rng, 0, 2)];

  return {
    externalRef: input.externalRef,
    name: input.name,
    birthDate: input.birthDate,
    nationality: input.nationality ?? "Unknown",
    position,
    preferredFoot,
    ...attributes,
    overall,
    potential,
  };
}
