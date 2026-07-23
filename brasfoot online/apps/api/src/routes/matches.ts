import { Router } from "express";
import { prisma } from "@brfut/db";
import { asyncHandler } from "../middleware/asyncHandler.js";

export const matchesRouter = Router();

const CHANCE_EVENTS = new Set(["GOAL", "PENALTY_GOAL", "PENALTY_MISSED", "CHANCE_MISSED"]);

function buildStats(
  events: { type: string; teamSide: string }[],
  homeScore: number | null,
  awayScore: number | null
) {
  const stats = {
    home: { goals: homeScore ?? 0, chances: 0, shots: 0, yellowCards: 0, redCards: 0, injuries: 0 },
    away: { goals: awayScore ?? 0, chances: 0, shots: 0, yellowCards: 0, redCards: 0, injuries: 0 },
  };

  for (const event of events) {
    const side = event.teamSide === "away" ? "away" : "home";
    if (CHANCE_EVENTS.has(event.type)) {
      stats[side].chances += 1;
      stats[side].shots += 1;
    }
    if (event.type === "YELLOW_CARD") stats[side].yellowCards += 1;
    if (event.type === "RED_CARD") stats[side].redCards += 1;
    if (event.type === "INJURY") stats[side].injuries += 1;
  }

  return stats;
}

matchesRouter.get(
  "/:matchId",
  asyncHandler(async (req, res) => {
    const { matchId } = req.params;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { homeClub: true, awayClub: true },
    });

    if (!match) {
      res.status(404).json({ error: "Match not found" });
      return;
    }

    res.json(match);
  })
);

matchesRouter.get(
  "/:matchId/report",
  asyncHandler(async (req, res) => {
    const { matchId } = req.params;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        season: {
          include: {
            league: { select: { id: true, name: true, country: true, format: true } },
          },
        },
        homeClub: { select: { id: true, name: true, shortName: true } },
        awayClub: { select: { id: true, name: true, shortName: true } },
        events: {
          include: {
            player: { select: { id: true, name: true, position: true } },
            relatedPlayer: { select: { id: true, name: true, position: true } },
          },
          orderBy: [{ minute: "asc" }, { second: "asc" }],
        },
        lineups: {
          include: {
            player: { select: { id: true, name: true, position: true, overall: true } },
            club: { select: { id: true, name: true, shortName: true } },
          },
          orderBy: [{ isStarting: "desc" }, { shirtNumber: "asc" }],
        },
      },
    });

    if (!match) {
      res.status(404).json({ error: "Match not found" });
      return;
    }

    const stats = buildStats(match.events, match.homeScore, match.awayScore);

    res.json({
      id: match.id,
      status: match.status,
      roundNumber: match.roundNumber,
      scheduledAt: match.scheduledAt,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      league: match.season.league,
      season: { id: match.season.id, name: match.season.name },
      homeClub: match.homeClub,
      awayClub: match.awayClub,
      stats,
      events: match.events.map((event) => ({
        id: event.id,
        minute: event.minute,
        second: event.second,
        type: event.type,
        teamSide: event.teamSide,
        player: event.player,
        relatedPlayer: event.relatedPlayer,
        metadata: event.metadata,
      })),
      lineups: match.lineups.map((lineup) => ({
        id: lineup.id,
        club: lineup.club,
        player: lineup.player,
        isStarting: lineup.isStarting,
        position: lineup.position,
        shirtNumber: lineup.shirtNumber,
        rating: lineup.rating === null ? null : Number(lineup.rating),
      })),
    });
  })
);
