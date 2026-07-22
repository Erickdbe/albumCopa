import type { RawCompetitionTeamsResponse, RawTeam } from "./types.js";

const BASE_URL = "https://api.football-data.org/v4";

export interface FootballDataClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin client for football-data.org. Only fetches identity data (team names,
 * squad names/positions/nationality/birth date) — this API has no concept of
 * gameplay ratings, those are generated separately (see attributeGenerator.ts).
 */
export class FootballDataClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FootballDataClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchCompetitionTeams(competitionCode: string): Promise<RawTeam[]> {
    const res = await this.fetchImpl(`${BASE_URL}/competitions/${competitionCode}/teams`, {
      headers: { "X-Auth-Token": this.apiKey },
    });

    if (!res.ok) {
      throw new Error(
        `football-data.org request failed (${res.status}): ${await res.text().catch(() => res.statusText)}`
      );
    }

    const body = (await res.json()) as RawCompetitionTeamsResponse;
    return body.teams;
  }
}
