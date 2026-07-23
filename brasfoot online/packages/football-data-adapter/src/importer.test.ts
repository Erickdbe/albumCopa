import { describe, expect, it } from "vitest";
import { hydrateImportedClubSquads, importCompetitionTeams } from "./index.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("football-data importer", () => {
  it("hydrates selected clubs with squad data from the team detail endpoint", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);

      if (url.endsWith("/competitions/BSA/teams")) {
        return jsonResponse({
          teams: [
            {
              id: 1,
              name: "Flamengo",
              shortName: "Flamengo",
              tla: "FLA",
              venue: "Maracana",
              area: { name: "Brazil" },
              squad: [],
            },
          ],
        });
      }

      if (url.endsWith("/teams/1")) {
        return jsonResponse({
          id: 1,
          name: "Flamengo",
          shortName: "Flamengo",
          tla: "FLA",
          venue: "Maracana",
          area: { name: "Brazil" },
          squad: [
            {
              id: 10,
              name: "Pedro",
              position: "Centre-Forward",
              dateOfBirth: "1997-06-20",
              nationality: "Brazil",
            },
          ],
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    };

    const clubs = await importCompetitionTeams({ apiKey: "test", fetchImpl }, "BSA");
    expect(clubs[0].players).toHaveLength(0);

    const hydrated = await hydrateImportedClubSquads({ apiKey: "test", fetchImpl }, clubs);

    expect(hydrated[0].players).toHaveLength(1);
    expect(hydrated[0].players[0]).toMatchObject({
      externalRef: "10",
      name: "Pedro",
      position: "ST",
      nationality: "Brazil",
    });
  });
});
