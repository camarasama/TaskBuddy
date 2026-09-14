/**
 * utils/client.ts — identifies the calling client from the `X-Client` header (P0-2).
 *
 * Format: `X-Client: <platform>/<semver>`, e.g. `taskbuddy-android/1.4.0`.
 *
 * Browsers never send this header, so its absence means "web" and every pre-existing code path
 * behaves exactly as before. That default matters more than it looks: it is what keeps the F-2
 * cookie-only refresh-token policy intact for the web client (see routes/auth.ts).
 *
 * Two things depend on this header:
 *   - Token delivery (P0-1): native clients have no cookie jar, so they receive the refresh token
 *     in the response body instead of an HttpOnly cookie.
 *   - Force-upgrade (P0-2): GET /meta/min-version compares the reported version against the oldest
 *     build we still support, so a broken release can be hard-blocked without a store rollout.
 *
 * An unparseable or spoofed header is not a privilege escalation. Claiming to be mobile only
 * changes *where* the caller's own refresh token is written — it grants no access to anyone
 * else's, and body-delivered credentials are explicit rather than ambient, so they carry no CSRF
 * risk (middleware/csrf.ts already exempts them).
 */

import type { Request } from 'express';

export const CLIENT_HEADER = 'x-client';

/** Platforms that cannot use cookies and must receive the refresh token in the body. */
export const MOBILE_PLATFORMS = ['taskbuddy-android', 'taskbuddy-ios'] as const;

export type MobilePlatform = (typeof MOBILE_PLATFORMS)[number];

export interface ClientInfo {
  platform: string;
  version: string;
}

// <platform>/<major.minor.patch>, with an optional prerelease/build suffix we accept but ignore.
const CLIENT_HEADER_PATTERN = /^([a-z0-9][a-z0-9-]{0,31})\/(\d{1,5}\.\d{1,5}\.\d{1,5})(?:[-+][0-9A-Za-z.-]{1,32})?$/;

/** Parse a raw `X-Client` value. Returns null for anything that doesn't match the contract. */
export function parseClientHeader(raw: string | undefined): ClientInfo | null {
  if (!raw) return null;
  const match = CLIENT_HEADER_PATTERN.exec(raw.trim().toLowerCase());
  if (!match) return null;
  return { platform: match[1], version: match[2] };
}

/** The calling client, or null for browsers and anything that didn't identify itself. */
export function getClient(req: Request): ClientInfo | null {
  return parseClientHeader(req.get(CLIENT_HEADER) ?? undefined);
}

export function isMobilePlatform(platform: string): platform is MobilePlatform {
  return (MOBILE_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * True when the request comes from a page on one of our own web origins (CLIENT_URL).
 *
 * Browsers attach `Origin` to every cross-origin fetch and cannot remove it; the native app's HTTP
 * stack never sends it. So our own origin in `Origin` means "a browser tab on our site" regardless of
 * what `X-Client` claims.
 */
export function isOwnWebOrigin(req: Request): boolean {
  const origin = req.get('origin');
  if (!origin) return false;
  const webOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return webOrigins.includes(origin);
}

/**
 * True only for a well-formed header naming a known native platform, sent by something that is not
 * a browser tab on our own site.
 *
 * The Origin half closes a gap the header alone left open (security audit 2026-09-14): script
 * running on app.gettaskbuddy.com (an XSS) could add `X-Client: taskbuddy-android/1.1.0` to a
 * credentialed `/auth/refresh` and receive the rotated refresh token in the JSON body, plus a 90-day
 * "mobile" session, defeating the HttpOnly cookie. Other origins are already refused by CORS and
 * hold no cookie, so our own web origins are the only ones that need the rule.
 */
export function isMobileClient(req: Request): boolean {
  if (isOwnWebOrigin(req)) return false;
  const client = getClient(req);
  return client !== null && isMobilePlatform(client.platform);
}

/** Numeric semver comparison. Returns <0, 0 or >0, sorting `a` against `b`. */
export function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = b.split('.').map(Number);
  return (aMajor - bMajor) || (aMinor - bMinor) || (aPatch - bPatch);
}
