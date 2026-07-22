import { samplePoisson } from "./poisson.js";

/**
 * Expected number of clear chances a team generates over 90 minutes.
 * Scales with the attack/opponent-defense ratio (stronger attack or weaker
 * opposing defense => more chances) and, more weakly, with possession share.
 */
export function expectedChances(attack: number, opponentDefense: number, possessionShare: number): number {
  const ratio = attack / (attack + opponentDefense); // 0..1, 0.5 = balanced
  const base = 3 + ratio * 6; // ~3 chances for a weak side, ~9 for a dominant one
  return base * (0.7 + possessionShare * 0.6);
}

export function sampleChanceCount(rng: () => number, lambda: number): number {
  return samplePoisson(rng, lambda);
}

/** Picks a minute (1-90) for a chance, biased slightly toward the second half. */
export function sampleChanceMinute(rng: () => number): number {
  const secondHalf = rng() < 0.55;
  const [min, max] = secondHalf ? [46, 90] : [1, 45];
  return Math.floor(rng() * (max - min + 1)) + min;
}
