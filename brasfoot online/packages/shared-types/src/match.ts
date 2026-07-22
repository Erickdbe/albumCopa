export type MatchEventType =
  | "GOAL"
  | "OWN_GOAL"
  | "PENALTY_GOAL"
  | "PENALTY_MISSED"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "INJURY"
  | "SUBSTITUTION"
  | "CHANCE_MISSED"
  | "KICK_OFF"
  | "HALF_TIME"
  | "FULL_TIME";

export type TeamSide = "home" | "away";

export interface SimMatchEvent {
  minute: number;
  second: number;
  type: MatchEventType;
  teamSide: TeamSide;
  playerId?: string;
  relatedPlayerId?: string;
  metadata?: Record<string, unknown>;
}

export interface MatchResult {
  homeScore: number;
  awayScore: number;
  events: SimMatchEvent[];
  playerRatings: Record<string, number>; // playerId -> rating (e.g. 4.0-10.0)
}

export interface TacticStyle {
  formation: string; // e.g. "4-4-2"
  mentality: "defensive" | "balanced" | "offensive";
  pressing: number; // 0-100
  width: number; // 0-100
  tempo: number; // 0-100
}
