import { FootballDataClient, type FootballDataClientOptions } from "./client.js";
import { generatePlayer } from "./attributeGenerator.js";
import type { GeneratedPlayer } from "@brfut/shared-types";

export { FootballDataClient } from "./client.js";
export { generatePlayer, mapRawPositionLabel } from "./attributeGenerator.js";
export * from "./types.js";

export interface ImportedClub {
  externalRef: string;
  name: string;
  shortName: string;
  stadiumName: string;
  country: string;
  reputation: number;
  players: GeneratedPlayer[];
}

/**
 * Fetches every team + squad in a competition and returns them normalized,
 * with gameplay attributes generated for each player. This is the function
 * packages/db's seed script calls when FOOTBALL_DATA_API_KEY is set.
 *
 * As of 2026, football-data.org's free tier returns `squad: []` for every
 * team — on both this endpoint and the team-detail one — so `players` will
 * come back empty here. That's confirmed against the live API, not a bug
 * in this fetch. Real identity (name, country, venue) still comes through
 * fine; packages/db's seed script is responsible for generating a
 * fictional squad for any club this returns with no players, rather than
 * this adapter silently inventing player identities it didn't fetch.
 */
export async function importCompetition(
  options: FootballDataClientOptions,
  competitionCode: string
): Promise<ImportedClub[]> {
  const client = new FootballDataClient(options);
  const teams = await client.fetchCompetitionTeams(competitionCode);

  return teams.map((team) => {
    // No official "reputation" stat exists publicly; approximate one from
    // squad size as a placeholder signal until a real rating source exists.
    const reputation = Math.min(90, 40 + (team.squad?.length ?? 0));

    const players = (team.squad ?? []).map((member) =>
      generatePlayer({
        externalRef: String(member.id),
        name: member.name,
        birthDate: member.dateOfBirth ?? "2000-01-01",
        nationality: member.nationality ?? "Unknown",
        rawPositionLabel: member.position,
        clubReputation: reputation,
      })
    );

    return {
      externalRef: String(team.id),
      name: team.name,
      shortName: team.shortName ?? team.tla ?? team.name,
      stadiumName: team.venue ?? `${team.name} Stadium`,
      country: team.area?.name ?? "Unknown",
      reputation,
      players,
    };
  });
}
