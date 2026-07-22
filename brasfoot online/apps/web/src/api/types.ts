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
}

export interface Player {
  id: string;
  name: string;
  position: string;
  overall: number;
  potential: number;
  morale: number;
  fitness: number;
  marketValue: string;
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
}

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
