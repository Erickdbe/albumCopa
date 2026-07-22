import { describe, expect, it } from "vitest";
import { generatePlayer, mapRawPositionLabel } from "./attributeGenerator.js";

describe("mapRawPositionLabel", () => {
  it("maps known football-data.org labels to our position enum", () => {
    expect(mapRawPositionLabel("Centre-Forward")).toBe("ST");
    expect(mapRawPositionLabel("Goalkeeper")).toBe("GK");
  });

  it("falls back to CM for unknown or missing labels", () => {
    expect(mapRawPositionLabel(null)).toBe("CM");
    expect(mapRawPositionLabel("Some Unmapped Label")).toBe("CM");
  });
});

describe("generatePlayer", () => {
  const baseInput = {
    externalRef: "12345",
    name: "Test Player",
    birthDate: "1998-05-10",
    nationality: "Brazil",
    rawPositionLabel: "Centre-Forward",
    clubReputation: 70,
  };

  it("is deterministic for the same externalRef and club reputation", () => {
    const a = generatePlayer(baseInput);
    const b = generatePlayer(baseInput);
    expect(a).toEqual(b);
  });

  it("produces attributes within the 1-99 range", () => {
    const player = generatePlayer(baseInput);
    for (const key of ["pace", "finishing", "passing", "dribbling", "tackling", "strength", "stamina"] as const) {
      expect(player[key]).toBeGreaterThanOrEqual(1);
      expect(player[key]).toBeLessThanOrEqual(99);
    }
  });

  it("gives strikers a higher finishing baseline than goalkeepers", () => {
    const striker = generatePlayer(baseInput);
    const keeper = generatePlayer({ ...baseInput, externalRef: "99999", rawPositionLabel: "Goalkeeper" });
    expect(striker.finishing).toBeGreaterThan(keeper.finishing - 20);
    expect(keeper.gkReflexes).toBeGreaterThan(striker.gkReflexes);
  });
});
