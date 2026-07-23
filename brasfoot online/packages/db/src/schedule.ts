import { prisma, type Club, type Match } from "./client.js";
import { hashStringToSeed } from "@brfut/shared-types";

export const COMPETITION_FORMATS = ["round_robin", "knockout", "cup"] as const;
export type CompetitionFormat = (typeof COMPETITION_FORMATS)[number];

type ScheduleClub = Pick<Club, "id" | "reputation" | "name">;

export function isCompetitionFormat(value: unknown): value is CompetitionFormat {
  return typeof value === "string" && COMPETITION_FORMATS.includes(value as CompetitionFormat);
}

export function isValidKnockoutClubCount(value: number): boolean {
  return Number.isInteger(value) && value >= 2 && value <= 32 && (value & (value - 1)) === 0;
}

export function isEliminationFormat(format: string): boolean {
  return format === "knockout" || format === "cup";
}

export function competitionFormatLabel(format: string): string {
  if (format === "knockout") return "Mata-mata";
  if (format === "cup") return "Copa";
  return "Pontos corridos";
}

export function roundLabel(format: string, clubsInRound: number, roundNumber: number): string {
  if (!isEliminationFormat(format)) return `Rodada ${roundNumber}`;
  if (clubsInRound <= 2) return "Final";
  if (clubsInRound === 4) return "Semifinal";
  if (clubsInRound === 8) return "Quartas de final";
  if (clubsInRound === 16) return "Oitavas de final";
  return `Fase com ${clubsInRound} clubes`;
}

function scheduleDate(roundNumber: number): Date {
  return new Date(Date.now() + (roundNumber - 1) * 60 * 60 * 1000);
}

function buildRoundRobinPairs(clubIds: string[]): Array<Array<{ homeClubId: string; awayClubId: string }>> {
  const rotating = [...clubIds];
  if (rotating.length % 2 === 1) rotating.push("__bye__");

  const roundCount = rotating.length - 1;
  const half = rotating.length / 2;
  const rounds: Array<Array<{ homeClubId: string; awayClubId: string }>> = [];

  for (let round = 0; round < roundCount; round++) {
    const matches: Array<{ homeClubId: string; awayClubId: string }> = [];
    for (let i = 0; i < half; i++) {
      const a = rotating[i];
      const b = rotating[rotating.length - 1 - i];
      if (a === "__bye__" || b === "__bye__") continue;

      const flip = round % 2 === 1;
      matches.push({
        homeClubId: flip ? b : a,
        awayClubId: flip ? a : b,
      });
    }
    rounds.push(matches);

    const fixed = rotating[0];
    const tail = rotating.slice(1);
    tail.unshift(tail.pop()!);
    rotating.splice(0, rotating.length, fixed, ...tail);
  }

  return rounds;
}

function buildKnockoutPairs(clubs: ScheduleClub[]): Array<{ homeClubId: string; awayClubId: string }> {
  const seeded = [...clubs].sort((a, b) => b.reputation - a.reputation || a.name.localeCompare(b.name));
  const pairs: Array<{ homeClubId: string; awayClubId: string }> = [];
  for (let i = 0; i < seeded.length / 2; i++) {
    pairs.push({
      homeClubId: seeded[i].id,
      awayClubId: seeded[seeded.length - 1 - i].id,
    });
  }
  return pairs;
}

export async function createInitialSchedule(params: {
  seasonId: string;
  clubs: ScheduleClub[];
  format: CompetitionFormat;
}) {
  if (params.clubs.length < 2) return;

  const existing = await prisma.match.count({ where: { seasonId: params.seasonId } });
  if (existing > 0) return;

  if (isEliminationFormat(params.format)) {
    if (!isValidKnockoutClubCount(params.clubs.length)) {
      throw new Error("Knockout competitions require 2, 4, 8, 16 or 32 clubs");
    }

    await prisma.match.createMany({
      data: buildKnockoutPairs(params.clubs).map((match) => ({
        seasonId: params.seasonId,
        roundNumber: 1,
        homeClubId: match.homeClubId,
        awayClubId: match.awayClubId,
        scheduledAt: scheduleDate(1),
        status: "SCHEDULED",
      })),
    });
    return;
  }

  const rounds = buildRoundRobinPairs(params.clubs.map((club) => club.id));
  await prisma.match.createMany({
    data: rounds.flatMap((matches, roundIndex) =>
      matches.map((match) => ({
        seasonId: params.seasonId,
        roundNumber: roundIndex + 1,
        homeClubId: match.homeClubId,
        awayClubId: match.awayClubId,
        scheduledAt: scheduleDate(roundIndex + 1),
        status: "SCHEDULED",
      }))
    ),
  });
}

export function getMatchWinnerClubId(match: Pick<Match, "id" | "homeClubId" | "awayClubId" | "homeScore" | "awayScore">): string {
  if (match.homeScore == null || match.awayScore == null) {
    throw new Error(`Match ${match.id} has no final score`);
  }
  if (match.homeScore > match.awayScore) return match.homeClubId;
  if (match.awayScore > match.homeScore) return match.awayClubId;

  // First playable knockout version: drawn matches are decided by a
  // deterministic penalty tiebreaker, so advancing the bracket is stable.
  return hashStringToSeed(match.id) % 2 === 0 ? match.homeClubId : match.awayClubId;
}

export async function advanceKnockoutIfReady(seasonId: string) {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    include: { league: true },
  });

  if (!isEliminationFormat(season.league.format)) {
    return { advanced: false, finished: false, reason: "not_elimination" as const };
  }

  const latestRound = await prisma.match.findFirst({
    where: { seasonId },
    orderBy: { roundNumber: "desc" },
  });
  if (!latestRound) {
    return { advanced: false, finished: false, reason: "no_matches" as const };
  }

  const currentMatches = await prisma.match.findMany({
    where: { seasonId, roundNumber: latestRound.roundNumber },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
  });

  if (currentMatches.some((match) => match.status !== "FINISHED")) {
    return { advanced: false, finished: false, reason: "round_not_finished" as const };
  }

  const winners = currentMatches.map(getMatchWinnerClubId);
  if (winners.length <= 1) {
    await prisma.season.update({ where: { id: seasonId }, data: { status: "FINISHED" } });
    return { advanced: false, finished: true, championClubId: winners[0] ?? null };
  }

  const nextRoundNumber = latestRound.roundNumber + 1;
  const existingNextRound = await prisma.match.count({ where: { seasonId, roundNumber: nextRoundNumber } });
  if (existingNextRound > 0) {
    return { advanced: false, finished: false, reason: "already_advanced" as const, roundNumber: nextRoundNumber };
  }

  const nextMatches = [];
  for (let i = 0; i < winners.length; i += 2) {
    nextMatches.push({
      seasonId,
      roundNumber: nextRoundNumber,
      homeClubId: winners[i],
      awayClubId: winners[i + 1],
      scheduledAt: scheduleDate(nextRoundNumber),
      status: "SCHEDULED" as const,
    });
  }

  await prisma.match.createMany({ data: nextMatches });
  return { advanced: true, finished: false, roundNumber: nextRoundNumber };
}
