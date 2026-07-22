import { createRng, hashStringToSeed, randomInRange } from "@brfut/shared-types";
import { generatePlayer, type ImportedClub } from "@brfut/football-data-adapter";
import type { GeneratedPlayer } from "@brfut/shared-types";

const FIRST_NAMES = ["Lucas", "Gabriel", "Matheus", "Rafael", "Bruno", "Thiago", "Diego", "Andre", "Felipe", "Vitor"];
const LAST_NAMES = ["Silva", "Santos", "Oliveira", "Souza", "Costa", "Pereira", "Almeida", "Nascimento", "Lima", "Araujo"];
const POSITION_LABELS = [
  "Goalkeeper",
  "Centre-Back",
  "Left-Back",
  "Right-Back",
  "Defensive Midfield",
  "Central Midfield",
  "Attacking Midfield",
  "Left Winger",
  "Right Winger",
  "Centre-Forward",
];

/**
 * Generates a plausible-enough fictional squad so the pipeline can be seeded
 * and simulated end-to-end without a FOOTBALL_DATA_API_KEY configured.
 */
export function generateFallbackSquad(clubExternalRef: string, clubReputation: number, size = 18): GeneratedPlayer[] {
  const rng = createRng(hashStringToSeed(`fallback:${clubExternalRef}`));

  return Array.from({ length: size }, (_, i) => {
    const first = FIRST_NAMES[randomInRange(rng, 0, FIRST_NAMES.length - 1)];
    const last = LAST_NAMES[randomInRange(rng, 0, LAST_NAMES.length - 1)];
    const positionLabel = POSITION_LABELS[i % POSITION_LABELS.length];
    const age = randomInRange(rng, 18, 35);
    const birthYear = new Date().getFullYear() - age;

    return generatePlayer({
      externalRef: `${clubExternalRef}-fallback-${i}`,
      name: `${first} ${last}`,
      birthDate: `${birthYear}-01-01`,
      nationality: "Brazil",
      rawPositionLabel: positionLabel,
      clubReputation,
    });
  });
}

/**
 * football-data.org's free tier returns `squad: []` for every team as of
 * 2026 (confirmed against the live API) — real club identity (name,
 * country) comes through fine, but there's no player data. Keeps the real
 * name and backfills a fictional squad for any club the API returns empty,
 * rather than leaving it unplayable. Shared by the CLI seed and the
 * "create private room" API endpoint.
 */
export function fillMissingSquads(clubs: ImportedClub[]): ImportedClub[] {
  return clubs.map((club) => {
    if (club.players.length > 0) return club;
    const reputation = randomInRange(createRng(hashStringToSeed(club.externalRef)), 55, 85);
    return { ...club, reputation, players: generateFallbackSquad(club.externalRef, reputation) };
  });
}
