import { describe, expect, it } from "vitest";
import { simulateMatch } from "../src/simulateMatch.js";
import type { LineupPlayer, TeamInput } from "../src/types.js";

function makePlayer(id: string, position: LineupPlayer["position"], overrides: Partial<LineupPlayer["attributes"]> = {}): LineupPlayer {
  return {
    id,
    position,
    morale: 75,
    fitness: 90,
    attributes: {
      pace: 60,
      finishing: 60,
      passing: 60,
      dribbling: 60,
      tackling: 60,
      strength: 60,
      stamina: 60,
      gkReflexes: 60,
      gkPositioning: 60,
      ...overrides,
    },
  };
}

function makeTeam(clubId: string, skillLevel: number): TeamInput {
  const positions: LineupPlayer["position"][] = ["GK", "CB", "CB", "LB", "RB", "DM", "CM", "AM", "LW", "RW", "ST"];
  return {
    clubId,
    tactic: { formation: "4-4-2", mentality: "balanced", pressing: 50, width: 50, tempo: 50 },
    players: positions.map((position, i) =>
      makePlayer(`${clubId}-p${i}`, position, {
        finishing: skillLevel,
        passing: skillLevel,
        dribbling: skillLevel,
        tackling: skillLevel,
        strength: skillLevel,
        gkReflexes: skillLevel,
        gkPositioning: skillLevel,
      })
    ),
  };
}

describe("simulateMatch determinism", () => {
  it("produces an identical result for the same seed and inputs", () => {
    const home = makeTeam("home", 65);
    const away = makeTeam("away", 65);

    const resultA = simulateMatch(home, away, "fixed-seed-123");
    const resultB = simulateMatch(home, away, "fixed-seed-123");

    expect(resultA).toEqual(resultB);
  });

  it("produces a different event sequence for a different seed", () => {
    const home = makeTeam("home", 65);
    const away = makeTeam("away", 65);

    const resultA = simulateMatch(home, away, "seed-A");
    const resultB = simulateMatch(home, away, "seed-B");

    expect(resultA).not.toEqual(resultB);
  });
});

describe("simulateMatch balance sanity", () => {
  it("has the stronger team win more often than the weaker team across many simulations", () => {
    const strongTeam = makeTeam("strong", 85);
    const weakTeam = makeTeam("weak", 35);

    let strongWins = 0;
    let weakWins = 0;
    const runs = 200;

    for (let i = 0; i < runs; i++) {
      const result = simulateMatch(strongTeam, weakTeam, `balance-check-${i}`);
      if (result.homeScore > result.awayScore) strongWins++;
      if (result.awayScore > result.homeScore) weakWins++;
    }

    expect(strongWins).toBeGreaterThan(weakWins);
    // Not a coin flip: the stronger side should win comfortably more often.
    expect(strongWins / runs).toBeGreaterThan(0.6);
  });

  it("keeps scorelines within a plausible football range", () => {
    const home = makeTeam("home", 65);
    const away = makeTeam("away", 60);

    for (let i = 0; i < 50; i++) {
      const result = simulateMatch(home, away, `range-check-${i}`);
      expect(result.homeScore).toBeGreaterThanOrEqual(0);
      expect(result.homeScore).toBeLessThanOrEqual(10);
      expect(result.awayScore).toBeGreaterThanOrEqual(0);
      expect(result.awayScore).toBeLessThanOrEqual(10);
    }
  });
});
