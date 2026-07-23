import { Prisma, prisma } from "@brfut/db";
import { simulateMatch } from "@brfut/simulation-engine";
import type { LineupPlayer, TeamInput } from "@brfut/simulation-engine";
import type { MatchResult, PlayerPosition, TacticStyle } from "@brfut/shared-types";
import { connection } from "../redis.js";
import { evolvePlayersAfterMatch } from "../playerEvolution.js";

const DEFAULT_TACTIC: TacticStyle = {
  formation: "4-4-2",
  mentality: "balanced",
  pressing: 50,
  width: 50,
  tempo: 50,
};

type PrismaPlayer = Awaited<ReturnType<typeof prisma.player.findMany>>[number];

function toLineupPlayer(player: PrismaPlayer): LineupPlayer {
  return {
    id: player.id,
    position: player.position as unknown as PlayerPosition,
    morale: player.morale,
    fitness: player.fitness,
    attributes: {
      pace: player.pace,
      finishing: player.finishing,
      passing: player.passing,
      dribbling: player.dribbling,
      tackling: player.tackling,
      strength: player.strength,
      stamina: player.stamina,
      gkReflexes: player.gkReflexes,
      gkPositioning: player.gkPositioning,
    },
  };
}

function pickFallbackStarters(players: PrismaPlayer[]): PrismaPlayer[] {
  const goalkeeper = players.find((p) => p.position === "GK");
  const outfieldSlots = goalkeeper ? 10 : 11;
  const outfield = players
    .filter((p) => p.position !== "GK")
    .sort((a, b) => b.overall - a.overall)
    .slice(0, outfieldSlots);
  return goalkeeper ? [goalkeeper, ...outfield] : outfield;
}

function pickStarters(players: PrismaPlayer[], tactic: TacticStyle): PrismaPlayer[] {
  const starterIds = tactic.starterIds;
  if (starterIds?.length === 11) {
    const playersById = new Map(players.map((player) => [player.id, player]));
    const selected = starterIds
      .map((playerId) => playersById.get(playerId))
      .filter((player): player is PrismaPlayer => Boolean(player));

    if (selected.length === 11 && selected.some((player) => player.position === "GK")) {
      return selected;
    }
  }

  return pickFallbackStarters(players);
}

/**
 * Picks a starting XI from a club's roster. No proper squad-selection /
 * user-set lineup exists yet (out of scope for this pass) — this just takes
 * the best available goalkeeper plus the ten highest-overall outfield
 * players (or the best 11 outfield players if the club has no goalkeeper),
 * enough to feed the simulation engine end-to-end.
 */
async function buildTeamInput(clubId: string): Promise<TeamInput> {
  const club = await prisma.club.findUniqueOrThrow({
    where: { id: clubId },
    include: { players: true },
  });

  const tactic = (club.tacticStyle as unknown as TacticStyle | null) ?? DEFAULT_TACTIC;
  const starters = pickStarters(club.players, tactic);

  return {
    clubId: club.id,
    tactic,
    players: starters.map(toLineupPlayer),
  };
}

type OutcomeMap = { home: "win" | "draw" | "loss"; away: "win" | "draw" | "loss" };

function determineOutcomes(homeScore: number, awayScore: number): OutcomeMap {
  if (homeScore > awayScore) return { home: "win", away: "loss" };
  if (homeScore < awayScore) return { home: "loss", away: "win" };
  return { home: "draw", away: "draw" };
}

/** Builds (without executing) the standing upsert for one club — included as
 * one leg of the outer $transaction so it can never drift out of sync with
 * the match result it's derived from. */
function buildStandingUpsert(
  seasonId: string,
  clubId: string,
  outcome: "win" | "draw" | "loss",
  goalsFor: number,
  goalsAgainst: number
) {
  const points = outcome === "win" ? 3 : outcome === "draw" ? 1 : 0;
  return prisma.standing.upsert({
    where: { seasonId_clubId: { seasonId, clubId } },
    create: {
      seasonId,
      clubId,
      played: 1,
      wins: outcome === "win" ? 1 : 0,
      draws: outcome === "draw" ? 1 : 0,
      losses: outcome === "loss" ? 1 : 0,
      goalsFor,
      goalsAgainst,
      points,
    },
    update: {
      played: { increment: 1 },
      wins: { increment: outcome === "win" ? 1 : 0 },
      draws: { increment: outcome === "draw" ? 1 : 0 },
      losses: { increment: outcome === "loss" ? 1 : 0 },
      goalsFor: { increment: goalsFor },
      goalsAgainst: { increment: goalsAgainst },
      points: { increment: points },
    },
  });
}

/** Shirt numbers are just 1..11 by starting order — no real squad-number
 * concept exists yet (out of scope for this pass). */
function buildLineupRows(
  matchId: string,
  clubId: string,
  team: TeamInput,
  ratings: Record<string, number>
): Prisma.MatchLineupCreateManyInput[] {
  return team.players.map((player, index) => ({
    matchId,
    clubId,
    playerId: player.id,
    isStarting: true,
    position: player.position,
    shirtNumber: index + 1,
    rating: ratings[player.id] ?? null,
  }));
}

/**
 * Publishes the pre-computed event log to a Redis Stream. The realtime
 * gateway consumes this stream and paces emission to spectators — the
 * simulation itself already happened, so this is just handing off a
 * timeline, not doing any more calculation.
 */
async function publishEventsToStream(matchId: string, result: MatchResult) {
  const streamKey = `match:${matchId}:events`;
  for (const event of result.events) {
    await connection.xadd(
      streamKey,
      "*",
      "minute",
      String(event.minute),
      "second",
      String(event.second),
      "type",
      event.type,
      "teamSide",
      event.teamSide,
      "playerId",
      event.playerId ?? "",
      "relatedPlayerId",
      event.relatedPlayerId ?? "",
      "metadata",
      JSON.stringify(event.metadata ?? {})
    );
  }
  await connection.xadd(
    streamKey,
    "*",
    "minute",
    "999",
    "second",
    "0",
    "type",
    "STREAM_END",
    "teamSide",
    "home",
    "playerId",
    "",
    "relatedPlayerId",
    "",
    "metadata",
    JSON.stringify({ homeScore: result.homeScore, awayScore: result.awayScore })
  );
}

export async function runSimulateMatchJob(matchId: string): Promise<MatchResult> {
  const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });

  if (match.status !== "SCHEDULED") {
    throw new Error(`Match ${matchId} is not SCHEDULED (status: ${match.status}) — refusing to re-simulate`);
  }

  const [homeTeam, awayTeam] = await Promise.all([
    buildTeamInput(match.homeClubId),
    buildTeamInput(match.awayClubId),
  ]);

  const seed = match.id;
  const result = simulateMatch(homeTeam, awayTeam, seed);
  const outcomes = determineOutcomes(result.homeScore, result.awayScore);

  const lineupRows = [
    ...buildLineupRows(match.id, match.homeClubId, homeTeam, result.playerRatings),
    ...buildLineupRows(match.id, match.awayClubId, awayTeam, result.playerRatings),
  ];

  // Everything derived from this simulation run — the result itself, the
  // event log, the lineup/ratings, and the standings it feeds into — lands
  // in one transaction. A crash mid-way rolls all of it back instead of
  // leaving the match FINISHED with stale standings.
  await prisma.$transaction([
    prisma.match.update({
      where: { id: match.id },
      data: {
        status: "FINISHED",
        homeScore: result.homeScore,
        awayScore: result.awayScore,
        simulationSeed: seed,
      },
    }),
    prisma.matchEvent.createMany({
      data: result.events.map((event) => ({
        matchId: match.id,
        minute: event.minute,
        second: event.second,
        type: event.type,
        teamSide: event.teamSide,
        playerId: event.playerId,
        relatedPlayerId: event.relatedPlayerId,
        metadata: (event.metadata ?? {}) as object,
      })),
    }),
    prisma.matchLineup.createMany({ data: lineupRows }),
    buildStandingUpsert(match.seasonId, match.homeClubId, outcomes.home, result.homeScore, result.awayScore),
    buildStandingUpsert(match.seasonId, match.awayClubId, outcomes.away, result.awayScore, result.homeScore),
  ]);

  await publishEventsToStream(match.id, result);

  // Not folded into the transaction above — a crash here shouldn't roll
  // back an already-final match result, and player development doesn't
  // need to be atomic with it.
  await evolvePlayersAfterMatch(
    match.id,
    lineupRows.map((row) => row.playerId)
  );

  return result;
}
