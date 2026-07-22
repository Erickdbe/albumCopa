/** Raw shapes we care about from football-data.org's v4 API (subset only). */

export interface RawSquadMember {
  id: number;
  name: string;
  position: string | null; // e.g. "Centre-Back", "Right Winger" — free-text, not an enum on their side
  dateOfBirth: string | null;
  nationality: string | null;
}

export interface RawTeam {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  venue: string | null;
  area?: { name: string } | null;
  squad?: RawSquadMember[];
}

export interface RawCompetitionTeamsResponse {
  teams: RawTeam[];
}

export interface NormalizedClub {
  externalRef: string;
  name: string;
  shortName: string;
  stadiumName: string;
}
