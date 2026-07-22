/** Knuth's algorithm — fine for the small lambdas (0-6ish) a football match needs. */
export function samplePoisson(rng: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}
