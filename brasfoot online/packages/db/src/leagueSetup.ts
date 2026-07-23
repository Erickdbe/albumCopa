import { prisma } from "./client.js";
import type { GeneratedPlayer } from "@brfut/shared-types";
import { createInitialSchedule, type CompetitionFormat } from "./schedule.js";

export interface LeagueSetupClub {
  name: string;
  shortName: string;
  stadiumName: string;
  reputation: number;
  players: GeneratedPlayer[];
}

export interface CreateLeagueParams {
  name: string;
  country: string;
  clubs: LeagueSetupClub[];
  isPrivate?: boolean;
  ownerId?: string;
  playbackSecondsPerMinute?: number;
  format?: CompetitionFormat;
  /** Only the CLI seed schedules a single sample match — real rooms don't
   * get one until a proper round-robin scheduler exists. */
  createDemoMatch?: boolean;
}

/**
 * Creates a league + active season + clubs + squads + standings as one
 * unit. Shared by the CLI seed script and the "create private room" API
 * endpoint so club/player creation logic only lives in one place.
 */
export async function createLeagueWithClubs(params: CreateLeagueParams) {
  const league = await prisma.league.create({
    data: {
      name: params.name,
      country: params.country,
      tier: 1,
      format: params.format ?? "round_robin",
      maxClubs: params.clubs.length,
      playbackSecondsPerMinute: params.playbackSecondsPerMinute ?? 2,
      isPrivate: params.isPrivate ?? false,
      ownerId: params.ownerId,
    },
  });

  const season = await prisma.season.create({
    data: {
      leagueId: league.id,
      name: `Temporada ${new Date().getFullYear()}`,
      startDate: new Date(),
      endDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180),
      status: "ACTIVE",
    },
  });

  const createdClubs = [];
  for (const club of params.clubs) {
    const created = await prisma.club.create({
      data: {
        leagueId: league.id,
        name: club.name,
        shortName: club.shortName,
        stadiumName: club.stadiumName,
        stadiumCapacity: 30000,
        balance: 5_000_000,
        reputation: club.reputation,
        players: {
          create: club.players.map((player) => ({
            name: player.name,
            birthDate: new Date(player.birthDate),
            nationality: player.nationality,
            position: player.position,
            preferredFoot: player.preferredFoot,
            pace: player.pace,
            finishing: player.finishing,
            passing: player.passing,
            dribbling: player.dribbling,
            tackling: player.tackling,
            strength: player.strength,
            stamina: player.stamina,
            gkReflexes: player.gkReflexes,
            gkPositioning: player.gkPositioning,
            overall: player.overall,
            potential: player.potential,
            marketValue: player.overall * 50_000,
            externalRef: player.externalRef,
          })),
        },
      },
    });
    createdClubs.push(created);

    await prisma.standing.create({
      data: { seasonId: season.id, clubId: created.id },
    });
  }

  await createInitialSchedule({
    seasonId: season.id,
    clubs: createdClubs.map((club) => ({ id: club.id, name: club.name, reputation: club.reputation })),
    format: params.format ?? "round_robin",
  });

  return { league, season, clubs: createdClubs };
}
