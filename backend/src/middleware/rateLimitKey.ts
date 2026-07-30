/**
 * Rate-limit key selection (P0-5).
 *
 * ## The problem this solves
 *
 * The global limiter used to key on IP alone. That is wrong for this product in two ways that only
 * show up in the field:
 *
 *   - **A household shares one public IP.** Two parents and two children on phones behind one router
 *     drained a single 100-request bucket between them. Found while testing the Android app against
 *     production: signing in as a child, signing out, then signing in as a parent was enough, because
 *     the laptop's browser was spending from the same allowance.
 *   - **Carrier NAT is worse.** On mobile networks many unrelated customers appear as one address, so
 *     one heavy user can rate-limit strangers. There is no configuration of a per-IP limit that is
 *     both safe against abuse and generous enough for that case.
 *
 * So an authenticated request is now counted against **its account**, and only unauthenticated
 * traffic falls back to the IP.
 *
 * ## Why the token is verified here, not merely decoded
 *
 * The key generator runs before `authenticate`, so `req.user` does not exist yet and the token has to
 * be read directly. It would be tempting to `jwt.decode` it — cheaper, no secret needed. That would
 * hand every caller an unlimited supply of buckets: forge `{"userId":"anything"}`, get a fresh 100
 * requests, repeat. A limiter that can be bypassed by editing a JSON payload is not a limiter.
 *
 * Verification uses the same secret and pinned algorithm/issuer/audience as `authenticate`, so a token
 * that would be rejected downstream is also rejected here and falls back to the IP bucket. An expired
 * token likewise buys nothing.
 *
 * ## Why `/auth/login` deliberately still keys on IP
 *
 * Login has no account yet — that is the entire point of the request — so there is nothing to key on
 * but the address. Keying it on the submitted email would let an attacker spray one address across
 * many accounts with a full allowance each, which is the attack the limiter exists to stop. The
 * separate `authLimiter` therefore stays IP-based, and its residual cost is real but small: a
 * household shares 10 sign-in attempts per 15 minutes.
 */
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

import { config } from '../config';
import { jwtVerifyOptions } from '../utils/jwt';

/**
 * Prefixes keep the two namespaces apart.
 *
 * Without them a user whose id happened to look like an address could share a bucket with that
 * address. Ids are cuid/uuid today so it cannot happen in practice — but the collision would be
 * invisible if it ever did, and one character prevents it.
 */
const USER_PREFIX = 'u:';
const IP_PREFIX = 'ip:';

/** Falls back to a fixed string when Express cannot determine an address, so the key is never empty. */
function ipKey(req: Request): string {
  return `${IP_PREFIX}${req.ip ?? 'unknown'}`;
}

/**
 * The bucket this request should count against: its account when it carries a valid access token,
 * otherwise its IP.
 */
export function rateLimitKey(req: Request): string {
  const header = req.headers.authorization;
  if (!header) return ipKey(req);

  // `Bearer <token>` — anything else is not something we can use.
  const [scheme, token] = header.split(' ');
  if (!/^Bearer$/i.test(scheme ?? '') || !token) return ipKey(req);

  try {
    const payload = jwt.verify(token, config.jwt.secret, jwtVerifyOptions) as { userId?: unknown };
    if (typeof payload.userId !== 'string' || payload.userId.length === 0) return ipKey(req);
    return `${USER_PREFIX}${payload.userId}`;
  } catch {
    // Expired, forged, wrong audience, wrong algorithm — all fall back to the IP bucket rather than
    // granting a fresh one. This is the branch that makes the limiter unbypassable.
    return ipKey(req);
  }
}
