import { prisma } from "@brfut/db";
import { OVERALL_SPECIALTY_ATTRIBUTES, calculateOverall, createRng, hashStringToSeed, randomInRange } from "@brfut/shared-types";
import type { PlayerAttributes, PlayerPosition } from "@brfut/shared-types";

const YOUNG_AGE_CEILING = 24;
const VETERAN_AGE_FLOOR = 31;
const YOUNG_GROWTH_CHANCE = 0.3;
const VETERAN_DECLINE_CHANCE = 0.25;

function ageFromBirthDate(birthDate: Date): number {
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) age--;
  return age;
}

/**
 * No separate calendar/training system exists yet — a simulated match is
 * the only "time passing" this game has, so player development happens
 * here. Young players (< 24) occasionally tick one of their position's
 * specialty attributes up toward their potential; veterans (31+)
 * occasionally tick one down. Seeded by matchId:playerId so it's
 * deterministic and reproducible, same as the match simulation itself.
 */
export async function evolvePlayersAfterMatch(matchId: string, playerIds: string[]): Promise<void> {
  const players = await prisma.player.findMany({ where: { id: { in: playerIds } } });

  for (const player of players) {
    const age = ageFromBirthDate(player.birthDate);
    const rng = createRng(hashStringToSeed(`evolve:${matchId}:${player.id}`));

    let direction: 1 | -1 | 0 = 0;
    if (age < YOUNG_AGE_CEILING && rng() < YOUNG_GROWTH_CHANCE) direction = 1;
    else if (age >= VETERAN_AGE_FLOOR && rng() < VETERAN_DECLINE_CHANCE) direction = -1;

    if (direction === 0) continue;

    const position = player.position as unknown as PlayerPosition;
    const specialtyKeys = OVERALL_SPECIALTY_ATTRIBUTES[position];
    const key = specialtyKeys[randomInRange(rng, 0, specialtyKeys.length - 1)];

    const attributes: PlayerAttributes = {
      pace: player.pace,
      finishing: player.finishing,
      passing: player.passing,
      dribbling: player.dribbling,
      tackling: player.tackling,
      strength: player.strength,
      stamina: player.stamina,
      gkReflexes: player.gkReflexes,
      gkPositioning: player.gkPositioning,
    };

    // Individual specialty attributes can already sit above the player's
    // whole-player `potential` (potential is derived from an average, one
    // attribute can run hotter than the rest) — capping growth at that
    // ceiling must never pull an already-above-ceiling attribute back DOWN,
    // only stop it from climbing further.
    let nextValue: number;
    if (direction === 1) {
      const ceiling = Math.min(99, player.potential);
      nextValue = attributes[key] >= ceiling ? attributes[key] : attributes[key] + 1;
    } else {
      nextValue = Math.max(1, attributes[key] - 1);
    }
    if (nextValue === attributes[key]) continue; // already at cap/floor, nothing to do

    attributes[key] = nextValue;
    const overall = calculateOverall(position, attributes);

    await prisma.player.update({
      where: { id: player.id },
      data: { [key]: nextValue, overall },
    });
  }
}
