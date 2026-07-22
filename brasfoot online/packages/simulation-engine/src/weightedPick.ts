/** Weighted random pick — higher `weight(item)` means more likely to be chosen. */
export function weightedPick<T>(rng: () => number, items: T[], weight: (item: T) => number): T {
  const weights = items.map((item) => Math.max(0.01, weight(item)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}
