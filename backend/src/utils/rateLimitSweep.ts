// F-10: prune expired entries from an in-memory rate-limit map so it cannot grow without bound.
// Entries carry a `resetAt` epoch-ms; anything already past its reset is safe to drop.

export interface RateEntry {
  resetAt: number;
}

/** Remove entries whose window has already elapsed. Returns the number removed. */
export function pruneExpired(map: Map<string, RateEntry>, now: number = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of map) {
    if (entry.resetAt < now) {
      map.delete(key);
      removed++;
    }
  }
  return removed;
}
