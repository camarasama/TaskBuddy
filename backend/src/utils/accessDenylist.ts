/**
 * Access tokens that must stop working before they expire (security audit 2026-09-14).
 *
 * Access tokens are verified by signature alone, so revoking a session only stopped its REFRESH
 * token. The access token already on the device kept working until it expired: up to an hour for a
 * parent and up to 24 hours for a child. "Sign out this device", a PIN reset, a password change and a
 * family suspension all left that window open.
 *
 * An access token's `jti` is the RefreshSession row id that issued it, so revoking a session adds the
 * ids of that session's recent rows here, and `authenticate` refuses them. Entries only need to live
 * as long as the longest access token could, after which the token has expired on its own.
 *
 * In memory, because the API runs as one process. `SessionService.hydrateAccessDenylist` refills it
 * from the database at boot so a restart does not reopen the window. Running more than one backend
 * process would need this moved to Postgres or Redis.
 *
 * Deliberately its own module with no imports: auth middleware reads it on every request, and many
 * test suites mock SessionService wholesale, which must not switch this check off.
 */

const denied = new Map<string, number>(); // jti -> epoch ms after which the entry is useless

/** Parse a jsonwebtoken-style duration ("15m", "24h", "7d", "3600") into milliseconds. */
export function durationMs(value: string | number | undefined, fallbackMs: number): number {
  if (value === undefined || value === '') return fallbackMs;
  if (typeof value === 'number') return value * 1000;
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(value.trim());
  if (!match) return fallbackMs;
  const n = Number(match[1]);
  const unit = match[2] ?? 's';
  const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return n * scale;
}

/**
 * The longest any access token can live: the larger of the parent and child lifetimes. Read at call
 * time so tests and deploys that change the env are honoured.
 */
export function maxAccessTtlMs(): number {
  const parent = durationMs(process.env.JWT_EXPIRES_IN, 60 * 60 * 1000);
  const child = durationMs(process.env.JWT_CHILD_ACCESS_EXPIRES_IN, 24 * 60 * 60 * 1000);
  return Math.max(parent, child);
}

export function denyAccess(jti: string, untilMs: number): void {
  if (untilMs <= Date.now()) return;
  const current = denied.get(jti);
  if (!current || current < untilMs) denied.set(jti, untilMs);
}

export function isAccessDenied(jti: string | undefined): boolean {
  if (!jti) return false;
  const until = denied.get(jti);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    denied.delete(jti);
    return false;
  }
  return true;
}

/** Drop entries whose tokens have expired anyway. Returns how many were removed. */
export function pruneAccessDenylist(now = Date.now()): number {
  let removed = 0;
  for (const [jti, until] of denied) {
    if (until <= now) {
      denied.delete(jti);
      removed++;
    }
  }
  return removed;
}

/** Test helper. */
export function clearAccessDenylist(): void {
  denied.clear();
}

export function accessDenylistSize(): number {
  return denied.size;
}
