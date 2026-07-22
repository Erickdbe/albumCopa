import type { PlayerAttributes, PlayerPosition, TacticStyle } from "@brfut/shared-types";

export interface LineupPlayer {
  id: string;
  position: PlayerPosition;
  attributes: PlayerAttributes;
  morale: number; // 0-100
  fitness: number; // 0-100
}

export interface TeamInput {
  clubId: string;
  players: LineupPlayer[]; // exactly 11 starters
  tactic: TacticStyle;
}

export interface TeamStrength {
  attack: number;
  midfield: number;
  defense: number;
  goalkeeping: number;
}
