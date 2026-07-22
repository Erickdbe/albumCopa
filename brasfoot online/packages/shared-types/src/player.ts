export type PlayerPosition = "GK" | "CB" | "LB" | "RB" | "DM" | "CM" | "AM" | "LW" | "RW" | "ST";

export type PreferredFoot = "LEFT" | "RIGHT" | "BOTH";

/** Gameplay ratings 1-99. Always generated — no public football API exposes these. */
export interface PlayerAttributes {
  pace: number;
  finishing: number;
  passing: number;
  dribbling: number;
  tackling: number;
  strength: number;
  stamina: number;
  gkReflexes: number;
  gkPositioning: number;
}

export interface PlayerIdentity {
  externalRef?: string;
  name: string;
  birthDate: string; // ISO date
  nationality: string;
  position: PlayerPosition;
  preferredFoot: PreferredFoot;
}

export type GeneratedPlayer = PlayerIdentity &
  PlayerAttributes & {
    overall: number;
    potential: number;
  };
