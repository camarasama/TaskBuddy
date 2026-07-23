// F-10: a socket authenticated with an access token must not outlive that token. Given the token's
// `exp` (seconds since epoch), this returns how long the socket may stay open.

/**
 * Milliseconds until the token expires. 0 (or negative clamped to 0) means "already expired" — the
 * caller should disconnect immediately. Undefined `exp` means "no known expiry" → null (do nothing).
 */
export function socketTtlMs(exp: number | undefined, now: number = Date.now()): number | null {
  if (!exp) return null;
  return Math.max(0, exp * 1000 - now);
}
