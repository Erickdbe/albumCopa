export interface AuthUser {
  id: string;
  email: string;
  username: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export type Mentality = "defensive" | "balanced" | "offensive";

export interface TacticStyle {
  formation: string;
  mentality: Mentality;
  pressing: number;
  width: number;
  tempo: number;
  starterIds?: string[];
}

export interface Player {
  id: string;
  name: string;
  position: string;
  birthDate?: string;
  nationality?: string;
  overall: number;
  potential: number;
  morale: number;
  fitness: number;
  form?: number;
  injuryStatus?: string | null;
  contractEndDate?: string | null;
  wage?: string | null;
  marketValue: string;
  pace?: number;
  finishing?: number;
  passing?: number;
  dribbling?: number;
  tackling?: number;
  strength?: number;
  stamina?: number;
  gkReflexes?: number;
  gkPositioning?: number;
}

export interface Club {
  id: string;
  userId: string | null;
  leagueId: string | null;
  name: string;
  shortName: string;
  stadiumName: string;
  stadiumCapacity: number;
  balance: string;
  reputation: number;
  formation: string;
  tacticStyle: TacticStyle | null;
  players?: Player[];
}

export interface League {
  id: string;
  name: string;
  country: string;
  tier: number;
  format?: CompetitionFormat;
  formatLabel?: string;
}

export type CompetitionFormat = "round_robin" | "knockout" | "cup";

export interface ClubSummary {
  id: string;
  name: string;
  shortName: string;
  reputation: number;
  isClaimed: boolean;
}

export const ALLOWED_FORMATIONS = ["4-4-2", "4-3-3", "3-5-2", "4-2-3-1", "5-3-2", "4-4-1-1", "3-4-3"] as const;
export const MENTALITIES: Mentality[] = ["defensive", "balanced", "offensive"];

/** 1-5 stars for display, derived from overall — nothing stored server-side. */
export function starsForOverall(overall: number): number {
  return Math.max(1, Math.min(5, Math.round(overall / 20)));
}

export interface ListingBid {
  id: string;
  amount: string;
  createdAt: string;
  bidderClub: { id: string; name: string };
}

export interface Listing {
  id: string;
  status: "OPEN" | "SOLD" | "EXPIRED" | "CANCELLED";
  startingPrice: string;
  buyNowPrice: string | null;
  currentBid: string | null;
  currentBidderClubId: string | null;
  endsAt: string;
  player: { id: string; name: string; position: string; overall: number; potential: number };
  sellerClub: { id: string; name: string; shortName: string };
  bids?: ListingBid[];
}

export interface SeasonMatchClub {
  id: string;
  name: string;
  shortName: string;
}

export interface SeasonMatch {
  id: string;
  status: "SCHEDULED" | "LIVE" | "FINISHED";
  scheduledAt: string;
  homeScore: number | null;
  awayScore: number | null;
  winnerClubId: string | null;
  homeClub: SeasonMatchClub;
  awayClub: SeasonMatchClub;
}

export interface SeasonRound {
  roundNumber: number;
  label: string;
  scheduledCount: number;
  finishedCount: number;
  totalMatches: number;
  isComplete: boolean;
  matches: SeasonMatch[];
}

export interface SeasonStanding {
  clubId: string;
  clubName: string;
  shortName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface SeasonPayload {
  league: {
    id: string;
    name: string;
    country: string;
    format: CompetitionFormat;
    formatLabel: string;
  };
  season: {
    id: string;
    name: string;
    status: "UPCOMING" | "ACTIVE" | "FINISHED";
    startDate: string;
    endDate: string;
  } | null;
  currentRoundNumber: number | null;
  champion: SeasonMatchClub | null;
  rounds: SeasonRound[];
  standings: SeasonStanding[];
}

export interface MatchReportClub {
  id: string;
  name: string;
  shortName: string;
}

export interface MatchReportPlayer {
  id: string;
  name: string;
  position: string;
  overall?: number;
}

export interface MatchReportStatLine {
  goals: number;
  chances: number;
  shots: number;
  yellowCards: number;
  redCards: number;
  injuries: number;
}

export interface MatchReportEvent {
  id: string;
  minute: number;
  second: number;
  type: string;
  teamSide: "home" | "away";
  player: MatchReportPlayer | null;
  relatedPlayer: MatchReportPlayer | null;
  metadata: Record<string, unknown> | null;
}

export interface MatchReportLineup {
  id: string;
  club: MatchReportClub;
  player: MatchReportPlayer;
  isStarting: boolean;
  position: string;
  shirtNumber: number;
  rating: number | null;
}

export interface MatchReport {
  id: string;
  status: "SCHEDULED" | "LIVE" | "FINISHED";
  roundNumber: number;
  scheduledAt: string;
  homeScore: number | null;
  awayScore: number | null;
  league: { id: string; name: string; country: string; format: CompetitionFormat };
  season: { id: string; name: string };
  homeClub: MatchReportClub;
  awayClub: MatchReportClub;
  stats: { home: MatchReportStatLine; away: MatchReportStatLine };
  events: MatchReportEvent[];
  lineups: MatchReportLineup[];
}
