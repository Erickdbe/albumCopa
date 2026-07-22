/**
 * Deterministic PRNG utilities shared by the simulation engine and the
 * football-data adapter's attribute generator. Same seed must always
 * produce the same sequence — this is what makes Match.simulationSeed
 * reproducible and lets both packages avoid depending on each other.
 */

export function hashStringToSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (Math.imul(31, hash) + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/** mulberry32 — small, fast, good-enough statistical quality for gameplay RNG. */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInRange(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}
