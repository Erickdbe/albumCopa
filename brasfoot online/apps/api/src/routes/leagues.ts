import { Router } from "express";
import {
  prisma,
  fillMissingSquads,
  generateFallbackSquad,
  createLeagueWithClubs,
  advanceKnockoutIfReady,
  competitionFormatLabel,
  getMatchWinnerClubId,
  isEliminationFormat,
  isCompetitionFormat,
  isValidKnockoutClubCount,
  roundLabel,
  type CompetitionFormat,
} from "@brfut/db";
import { importCompetition } from "@brfut/football-data-adapter";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { createRoomRateLimit } from "../middleware/apiRateLimit.js";
import { simulateMatchQueue } from "../queues.js";

export const leaguesRouter = Router();

const MIN_CLUB_COUNT = 2;
const MAX_CLUB_COUNT = 40;
const KNOCKOUT_MAX_CLUB_COUNT = 32;

const FALLBACK_CLUB_NAMES = [
  "Litoral FC",
  "Textil United",
  "Atletico Galpao",
  "Operario Azul",
  "Real Expedicao",
  "Porto Verde",
  "Uniao Costeira",
  "Estrela Fabril",
  "Vila Nova SC",
  "Metalurgicos FC",
  "Santa Linha",
  "Ribeirao AC",
  "Comercial Norte",
  "Juventude Sul",
  "America do Vale",
  "Independente Praia",
  "Nacional Tecido",
  "Sporting Almox",
  "Ferroviario Litoral",
  "Aurora FC",
  "Bonsucesso",
  "Cruzeiro do Porto",
  "Palmeiras da Vila",
  "Uniao Central",
  "Internacional BR",
  "Guarani Fabril",
  "Nova Esperanca",
  "Santos do Bairro",
  "Flamengo Popular",
  "Vitoria Litoral",
  "Corinthians Local",
  "Botafogo do Canal",
  "Atletico Matriz",
  "Gremio dos Amigos",
  "Fortaleza Norte",
  "Bahia Operaria",
  "Ceara Industrial",
  "Parana Clube",
  "Goias Verde",
  "Amazonas Azul",
];

function fallbackClubs(roomName: string, clubCount: number) {
  return Array.from({ length: clubCount }, (_, index) => {
    const name = FALLBACK_CLUB_NAMES[index] ?? `${roomName} ${index + 1}`;
    const shortName = name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 3)
      .toUpperCase()
      .padEnd(3, "F");
    const reputation = 50 + ((index * 7) % 35);
    return {
      name,
      shortName,
      stadiumName: `Estadio ${name}`,
      country: "Brazil",
      reputation,
      players: generateFallbackSquad(`room:${roomName}:${index}`, reputation),
    };
  });
}

async function userCanControlLeague(userId: string, leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) return false;
  if (league.ownerId) return league.ownerId === userId;

  const club = await prisma.club.findFirst({ where: { leagueId, userId } });
  return club !== null;
}

// Lets the web app discover which *public* leagues exist before drilling
// into one's clubs to claim. Private rooms (see POST /) never show up
// here — they're only reachable by ID, which doubles as the invite link.
leaguesRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const leagues = await prisma.league.findMany({ where: { isPrivate: false }, orderBy: { name: "asc" } });
    res.json({
      leagues: leagues.map((league) => ({
        id: league.id,
        name: league.name,
        country: league.country,
        tier: league.tier,
        format: league.format,
        formatLabel: competitionFormatLabel(league.format),
      })),
    });
  })
);

// Deliberately does NOT filter by isPrivate — this is how a private room's
// "invite link" works: anyone with the ID can look it up directly, it's
// just excluded from the public GET / listing above.
leaguesRouter.get(
  "/:leagueId",
  asyncHandler(async (req, res) => {
    const league = await prisma.league.findUnique({ where: { id: req.params.leagueId } });
    if (!league) {
      res.status(404).json({ error: "League not found" });
      return;
    }
    res.json({
      id: league.id,
      name: league.name,
      country: league.country,
      tier: league.tier,
      format: league.format,
      formatLabel: competitionFormatLabel(league.format),
      isPrivate: league.isPrivate,
    });
  })
);

// Creates a private room: a user-chosen real competition, capped to a
// user-chosen number of clubs. Not listed publicly — only reachable by the
// returned league id.
leaguesRouter.post(
  "/",
  requireAuth,
  createRoomRateLimit,
  asyncHandler(async (req, res) => {
    const { name, competitionCode, clubCount } = req.body ?? {};
    const format: CompetitionFormat = isCompetitionFormat(req.body?.format) ? req.body.format : "round_robin";

    if (typeof name !== "string" || name.trim().length < 3) {
      res.status(400).json({ error: "name must be at least 3 characters" });
      return;
    }
    if (typeof competitionCode !== "string" || competitionCode.trim().length === 0) {
      res.status(400).json({ error: "competitionCode is required" });
      return;
    }
    const isElimination = isEliminationFormat(format);

    if (
      typeof clubCount !== "number" ||
      !Number.isInteger(clubCount) ||
      clubCount < MIN_CLUB_COUNT ||
      clubCount > (isElimination ? KNOCKOUT_MAX_CLUB_COUNT : MAX_CLUB_COUNT)
    ) {
      res.status(400).json({
        error: `clubCount must be an integer between ${MIN_CLUB_COUNT} and ${
          isElimination ? KNOCKOUT_MAX_CLUB_COUNT : MAX_CLUB_COUNT
        }`,
      });
      return;
    }
    if (isElimination && !isValidKnockoutClubCount(clubCount)) {
      res.status(400).json({ error: `${competitionFormatLabel(format)} precisa de 2, 4, 8, 16 ou 32 clubes` });
      return;
    }

    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    let selected;
    if (apiKey) {
      let importedClubs;
      try {
        importedClubs = await importCompetition({ apiKey }, competitionCode.trim());
      } catch (err) {
        res.status(502).json({
          error: `Could not fetch competition "${competitionCode}" from football-data.org: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        });
        return;
      }

      if (importedClubs.length === 0) {
        res.status(502).json({ error: `Competition "${competitionCode}" returned no clubs` });
        return;
      }

      selected = fillMissingSquads(importedClubs.slice(0, clubCount));
    } else {
      selected = fallbackClubs(name.trim(), clubCount);
    }

    const { league } = await createLeagueWithClubs({
      name: name.trim(),
      country: selected[0].country,
      clubs: selected,
      format,
      isPrivate: true,
      ownerId: req.user!.sub,
    });

    res.status(201).json({
      id: league.id,
      name: league.name,
      country: league.country,
      format: league.format,
      formatLabel: competitionFormatLabel(league.format),
      clubCount: selected.length,
    });
  })
);

async function buildSeasonPayload(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) return null;

  const season = await prisma.season.findFirst({
    where: { leagueId, status: { in: ["ACTIVE", "FINISHED"] } },
    orderBy: { startDate: "desc" },
  });
  if (!season) {
    return {
      league: {
        id: league.id,
        name: league.name,
        country: league.country,
        format: league.format,
        formatLabel: competitionFormatLabel(league.format),
      },
      season: null,
      rounds: [],
      standings: [],
      currentRoundNumber: null,
      champion: null,
    };
  }

  const [matches, standings] = await Promise.all([
    prisma.match.findMany({
      where: { seasonId: season.id },
      include: {
        homeClub: { select: { id: true, name: true, shortName: true } },
        awayClub: { select: { id: true, name: true, shortName: true } },
      },
      orderBy: [{ roundNumber: "asc" }, { scheduledAt: "asc" }, { id: "asc" }],
    }),
    prisma.standing.findMany({
      where: { seasonId: season.id },
      include: { club: { select: { id: true, name: true, shortName: true } } },
      orderBy: [
        { points: "desc" },
        { wins: "desc" },
        { goalsFor: "desc" },
      ],
    }),
  ]);

  const grouped = new Map<number, typeof matches>();
  for (const match of matches) {
    grouped.set(match.roundNumber, [...(grouped.get(match.roundNumber) ?? []), match]);
  }

  const rounds = [...grouped.entries()].map(([roundNumber, roundMatches]) => {
    const scheduledCount = roundMatches.filter((match) => match.status === "SCHEDULED").length;
    const finishedCount = roundMatches.filter((match) => match.status === "FINISHED").length;
    return {
      roundNumber,
      label: roundLabel(league.format, roundMatches.length * 2, roundNumber),
      scheduledCount,
      finishedCount,
      totalMatches: roundMatches.length,
      isComplete: roundMatches.length > 0 && finishedCount === roundMatches.length,
      matches: roundMatches.map((match) => ({
        id: match.id,
        status: match.status,
        scheduledAt: match.scheduledAt,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        homeClub: match.homeClub,
        awayClub: match.awayClub,
        winnerClubId:
          match.status === "FINISHED" &&
          (isEliminationFormat(league.format) || match.homeScore !== match.awayScore)
            ? getMatchWinnerClubId(match)
            : null,
      })),
    };
  });

  const currentRound = rounds.find((round) => round.scheduledCount > 0) ?? rounds.at(-1) ?? null;
  const finalRound = rounds.at(-1) ?? null;
  const finalMatch = finalRound?.matches.length === 1 ? finalRound.matches[0] : null;
  const knockoutChampionId =
    isEliminationFormat(league.format) && finalMatch?.status === "FINISHED" ? finalMatch.winnerClubId : null;
  const standingsChampion = !isEliminationFormat(league.format) && matches.every((match) => match.status === "FINISHED")
    ? standings[0]?.club
    : null;
  const knockoutChampion = knockoutChampionId
    ? standings.find((standing) => standing.clubId === knockoutChampionId)?.club ??
      (await prisma.club.findUnique({
        where: { id: knockoutChampionId },
        select: { id: true, name: true, shortName: true },
      }))
    : null;

  return {
    league: {
      id: league.id,
      name: league.name,
      country: league.country,
      format: league.format,
      formatLabel: competitionFormatLabel(league.format),
    },
    season: {
      id: season.id,
      name: season.name,
      status: season.status,
      startDate: season.startDate,
      endDate: season.endDate,
    },
    currentRoundNumber: currentRound?.roundNumber ?? null,
    champion: knockoutChampion ?? standingsChampion ?? null,
    rounds,
    standings: standings.map((s) => ({
      clubId: s.clubId,
      clubName: s.club.name,
      shortName: s.club.shortName,
      played: s.played,
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
      goalDifference: s.goalsFor - s.goalsAgainst,
      points: s.points,
    })),
  };
}

leaguesRouter.get(
  "/:leagueId/season",
  asyncHandler(async (req, res) => {
    const payload = await buildSeasonPayload(req.params.leagueId);
    if (!payload) {
      res.status(404).json({ error: "League not found" });
      return;
    }
    res.json(payload);
  })
);

leaguesRouter.post(
  "/:leagueId/season/rounds/:roundNumber/simulate",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { leagueId } = req.params;
    const roundNumber = Number(req.params.roundNumber);

    if (!Number.isInteger(roundNumber) || roundNumber < 1) {
      res.status(400).json({ error: "roundNumber must be a positive integer" });
      return;
    }

    const canControl = await userCanControlLeague(req.user!.sub, leagueId);
    if (!canControl) {
      res.status(403).json({ error: "Only the room owner can simulate this competition" });
      return;
    }

    const season = await prisma.season.findFirst({
      where: { leagueId, status: "ACTIVE" },
      include: { league: true },
      orderBy: { startDate: "desc" },
    });
    if (!season) {
      res.status(404).json({ error: "No active season found for this league" });
      return;
    }

    const matches = await prisma.match.findMany({
      where: { seasonId: season.id, roundNumber },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    });
    if (matches.length === 0) {
      res.status(404).json({ error: "Round not found" });
      return;
    }

    const scheduledMatches = matches.filter((match) => match.status === "SCHEDULED");
    if (scheduledMatches.length === 0) {
      if (isEliminationFormat(season.league.format)) {
        const advance = await advanceKnockoutIfReady(season.id);
        const payload = await buildSeasonPayload(leagueId);
        res.json({ enqueued: 0, advance, season: payload });
        return;
      }

      const remainingScheduled = await prisma.match.count({ where: { seasonId: season.id, status: "SCHEDULED" } });
      if (remainingScheduled === 0) {
        await prisma.season.update({ where: { id: season.id }, data: { status: "FINISHED" } });
      }
      const payload = await buildSeasonPayload(leagueId);
      res.json({ enqueued: 0, season: payload });
      return;
    }

    await Promise.all(
      scheduledMatches.map((match) =>
        simulateMatchQueue.add(
          "simulate-match",
          { matchId: match.id },
          { jobId: `simulate-match:${match.id}`, removeOnComplete: 100, removeOnFail: 100 }
        )
      )
    );

    const payload = await buildSeasonPayload(leagueId);
    res.status(202).json({ enqueued: scheduledMatches.length, season: payload });
  })
);

// Read-only: enough for the web scaffold to render a table. Creating
// leagues/seasons and admin operations are next-iteration work.
leaguesRouter.get("/:leagueId/standings", asyncHandler(async (req, res) => {
  const { leagueId } = req.params;

  const season = await prisma.season.findFirst({
    where: { leagueId, status: "ACTIVE" },
    orderBy: { startDate: "desc" },
  });
  if (!season) {
    res.status(404).json({ error: "No active season found for this league" });
    return;
  }

  const standings = await prisma.standing.findMany({
    where: { seasonId: season.id },
    include: { club: true },
    orderBy: [{ points: "desc" }, { goalsFor: "desc" }],
  });

  res.json({
    seasonId: season.id,
    standings: standings.map((s) => ({
      clubId: s.clubId,
      clubName: s.club.name,
      played: s.played,
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      goalsFor: s.goalsFor,
      goalsAgainst: s.goalsAgainst,
      points: s.points,
    })),
  });
}));

// Lets a user see which clubs in a league are free to claim
// (POST /clubs/:clubId/claim) before picking one.
leaguesRouter.get(
  "/:leagueId/clubs",
  asyncHandler(async (req, res) => {
    const { leagueId } = req.params;

    const clubs = await prisma.club.findMany({
      where: { leagueId },
      orderBy: { name: "asc" },
    });

    res.json({
      clubs: clubs.map((club) => ({
        id: club.id,
        name: club.name,
        shortName: club.shortName,
        reputation: club.reputation,
        isClaimed: club.userId !== null,
      })),
    });
  })
);
