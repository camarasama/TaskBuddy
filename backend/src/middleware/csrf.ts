/**
 * middleware/csrf.ts — double-submit CSRF protection for cookie-authenticated endpoints.
 *
 * Scope is deliberately narrow. Almost every route authenticates from an `Authorization: Bearer`
 * header, which a cross-site attacker cannot set, so those routes have no CSRF exposure and get no
 * CSRF ceremony. Exactly two endpoints accept an *ambient* credential — the `refreshToken` cookie:
 *
 *   POST /auth/refresh   → mints a fresh access token
 *   POST /auth/logout    → revokes the server-side session
 *
 * Those are reachable cross-site because the refresh cookie is `SameSite=None` in production (it
 * has to be: the app and API are on different subdomains). Without protection, any page could force
 * a logout, or drive a refresh to keep a stolen session chain alive.
 *
 * Design — double submit:
 *   - A random token is issued in a NON-HttpOnly `csrfToken` cookie whenever a refresh cookie is
 *     set, so a logged-in client always holds one.
 *   - The client echoes it in an `X-CSRF-Token` header.
 *   - Both must match. An attacker on another origin cannot read the cookie (the same-origin policy
 *     and our CORS allowlist prevent it), so they cannot produce the header.
 *
 * Requests that supply the refresh token in the request BODY instead of the cookie are exempt:
 * that is an explicit credential, not an ambient one, so it carries no CSRF risk. This keeps the
 * documented mobile path (see the TODO in routes/auth.ts) working untouched.
 */

import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from './errorHandler';

export const CSRF_COOKIE = 'csrfToken';
export const CSRF_HEADER = 'x-csrf-token';

function csrfCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  const isCrossOrigin = process.env.CROSS_ORIGIN_COOKIES === 'true' || isProduction;
  return {
    // Readable by JS on purpose — the client must echo it back in a header. It is not a
    // credential: it authorises nothing on its own and is worthless without the refresh cookie.
    httpOnly: false,
    secure: isCrossOrigin,
    sameSite: (isCrossOrigin ? 'none' : 'lax') as 'none' | 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

/** Mint a CSRF token and set it as a readable cookie. Call wherever a refresh cookie is set. */
export function issueCsrfCookie(res: Response): string {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  return token;
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE, csrfCookieOptions());
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, which would itself leak length via the error path.
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Reject a state-changing request that relies on the ambient refresh cookie unless it also carries
 * a matching CSRF header.
 */
export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  const usedAmbientCookie = Boolean(req.cookies?.refreshToken);
  if (!usedAmbientCookie) return next(); // explicit body credential (or none) → not a CSRF vector

  const headerToken = req.get(CSRF_HEADER);
  const cookieToken = req.cookies?.[CSRF_COOKIE];

  if (!headerToken || !cookieToken || !safeEqual(headerToken, cookieToken)) {
    return next(
      new ForbiddenError(
        'Missing or invalid CSRF token. Fetch one from GET /auth/csrf-token and send it as the X-CSRF-Token header.'
      )
    );
  }
  return next();
}
