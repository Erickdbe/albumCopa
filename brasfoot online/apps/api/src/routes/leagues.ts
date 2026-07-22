import { Router } from "express";
import { prisma, fillMissingSquads, createLeagueWithClubs } from "@brfut/db";
import { importCompetition } from "@brfut/football-data-adapter";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { createRoomRateLimit } from "../middleware/apiRateLimit.js";

export const leaguesRouter = Router();

const MIN_CLUB_COUNT = 2;
const MAX_CLUB_COUNT = 40;

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

    if (typeof name !== "string" || name.trim().length < 3) {
      res.status(400).json({ error: "name must be at least 3 characters" });
      return;
    }
    if (typeof competitionCode !== "string" || competitionCode.trim().length === 0) {
      res.status(400).json({ error: "competitionCode is required" });
      return;
    }
    if (
      typeof clubCount !== "number" ||
      !Number.isInteger(clubCount) ||
      clubCount < MIN_CLUB_COUNT ||
      clubCount > MAX_CLUB_COUNT
    ) {
      res.status(400).json({ error: `clubCount must be an integer between ${MIN_CLUB_COUNT} and ${MAX_CLUB_COUNT}` });
      return;
    }

    const apiKey = process.env.FOOTBALL_DATA_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "Server is not configured with a football-data.org API key" });
      return;
    }

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

    const selected = fillMissingSquads(importedClubs.slice(0, clubCount));

    const { league } = await createLeagueWithClubs({
      name: name.trim(),
      country: selected[0].country,
      clubs: selected,
      isPrivate: true,
      ownerId: req.user!.sub,
    });

    res.status(201).json({
      id: league.id,
      name: league.name,
      country: league.country,
      clubCount: selected.length,
    });
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
