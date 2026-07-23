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

function reputationFromTeam(team: { squad?: unknown[] }): number {
  return Math.min(90, 40 + (team.squad?.length ?? 0));
}

function normalizeTeam(team: Awaited<ReturnType<FootballDataClient["fetchTeam"]>>): ImportedClub {
  const reputation = reputationFromTeam(team);
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
}

/**
 * Fetches every team in a competition and returns them normalized with any
 * squad data the list endpoint provides.
 *
 * As of 2026, football-data.org's free tier returns `squad: []` for every
 * team in some competitions, so `players` may come back empty here. Real
 * identity (name, country, venue) still comes through fine; callers are
 * responsible for generating a fallback squad for empty clubs.
 */
export async function importCompetitionTeams(
  options: FootballDataClientOptions,
  competitionCode: string
): Promise<ImportedClub[]> {
  const client = new FootballDataClient(options);
  const teams = await client.fetchCompetitionTeams(competitionCode);

  return teams.map(normalizeTeam);
}

/**
 * Fetches `/teams/{id}` for already selected clubs. Keep this separate from
 * the competition import so room creation can draw clubs first, then spend
 * detail requests only on the clubs that actually enter the room.
 */
export async function hydrateImportedClubSquads(
  options: FootballDataClientOptions,
  clubs: ImportedClub[]
): Promise<ImportedClub[]> {
  const client = new FootballDataClient(options);
  const hydrated: ImportedClub[] = [];

  for (const club of clubs) {
    const teamId = Number(club.externalRef);
    if (!Number.isInteger(teamId)) {
      hydrated.push(club);
      continue;
    }

    try {
      const detailedTeam = await client.fetchTeam(teamId);
      const detailedClub = normalizeTeam(detailedTeam);
      hydrated.push({
        ...club,
        name: detailedClub.name || club.name,
        shortName: detailedClub.shortName || club.shortName,
        stadiumName: detailedClub.stadiumName || club.stadiumName,
        country: detailedClub.country || club.country,
        reputation: detailedClub.players.length > 0 ? detailedClub.reputation : club.reputation,
        players: detailedClub.players.length > 0 ? detailedClub.players : club.players,
      });
    } catch {
      hydrated.push(club);
    }
  }

  return hydrated;
}

/**
 * Fetches every team + squad in a competition and returns them normalized,
 * with gameplay attributes generated for each imported player. This is the
 * function packages/db's seed script calls when FOOTBALL_DATA_API_KEY is set.
 */
export async function importCompetition(
  options: FootballDataClientOptions,
  competitionCode: string
): Promise<ImportedClub[]> {
  return importCompetitionTeams(options, competitionCode);
}
