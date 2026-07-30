/**
 * P0-5 — rate-limit key selection.
 *
 * The limiter used to key on IP alone, so a household behind one router shared a single bucket, and on
 * carrier NAT so did strangers. An authenticated request is now counted against its account.
 *
 * The security-critical case is the forged token. The key generator has to read the JWT before
 * `authenticate` runs, and if it merely *decoded* it, anyone could mint unlimited buckets by editing a
 * userId into an unsigned payload — a limiter bypassable with a text editor. So the tests below care as
 * much about which tokens are refused as which are accepted.
 */
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

import { config } from '../src/config';
import { jwtSignOptions, JWT_MFA_AUDIENCE, JWT_ISSUER } from '../src/utils/jwt';
import { rateLimitKey } from '../src/middleware/rateLimitKey';

/** Minimal stand-in — the key generator only reads `headers.authorization` and `ip`. */
function req(authorization?: string, ip = '203.0.113.7'): Request {
  return { headers: authorization ? { authorization } : {}, ip } as unknown as Request;
}

function validToken(userId = 'user-123', extra: Record<string, unknown> = {}): string {
  return jwt.sign({ userId, familyId: 'fam-1', role: 'parent', ...extra }, config.jwt.secret, {
    ...jwtSignOptions,
    expiresIn: '15m',
  });
}

describe('authenticated requests are counted per account', () => {
  it('keys on the user id from a valid access token', () => {
    // The whole point: two devices on one connection, signed in as different people, get their own
    // buckets instead of draining a shared one.
    expect(rateLimitKey(req(`Bearer ${validToken('parent-a')}`))).toBe('u:parent-a');
    expect(rateLimitKey(req(`Bearer ${validToken('child-b')}`))).toBe('u:child-b');
  });

  it('ignores the IP entirely once the token is valid', () => {
    const token = `Bearer ${validToken('same-user')}`;
    // Same account roaming between wifi and mobile data stays one bucket.
    expect(rateLimitKey(req(token, '203.0.113.7'))).toBe('u:same-user');
    expect(rateLimitKey(req(token, '198.51.100.42'))).toBe('u:same-user');
  });

  it('accepts a lowercase bearer scheme', () => {
    expect(rateLimitKey(req(`bearer ${validToken('user-123')}`))).toBe('u:user-123');
  });
});

describe('unauthenticated requests fall back to the IP', () => {
  it('keys on the IP with no Authorization header', () => {
    expect(rateLimitKey(req(undefined, '203.0.113.7'))).toBe('ip:203.0.113.7');
  });

  it('does not produce an empty key when Express has no address', () => {
    expect(rateLimitKey({ headers: {}, ip: undefined } as unknown as Request)).toBe('ip:unknown');
  });

  it('ignores a non-Bearer scheme', () => {
    expect(rateLimitKey(req('Basic dXNlcjpwYXNz'))).toBe('ip:203.0.113.7');
  });

  it('ignores a Bearer header with no token', () => {
    expect(rateLimitKey(req('Bearer'))).toBe('ip:203.0.113.7');
    expect(rateLimitKey(req('Bearer '))).toBe('ip:203.0.113.7');
  });
});

describe('tokens that must NOT buy a fresh bucket', () => {
  it('refuses a token signed with the wrong secret', () => {
    /**
     * The attack the verification exists to stop. If this fell through to `u:attacker`, anyone could
     * hand themselves an unlimited number of buckets.
     */
    const forged = jwt.sign({ userId: 'attacker' }, 'not-the-real-secret', {
      ...jwtSignOptions,
      expiresIn: '15m',
    });

    expect(rateLimitKey(req(`Bearer ${forged}`))).toBe('ip:203.0.113.7');
  });

  it('refuses an unsigned (alg: none) token', () => {
    // The classic jsonwebtoken foot-gun, blocked by pinning algorithms in jwtVerifyOptions.
    const unsigned = jwt.sign({ userId: 'attacker' }, '', { algorithm: 'none' } as jwt.SignOptions);

    expect(rateLimitKey(req(`Bearer ${unsigned}`))).toBe('ip:203.0.113.7');
  });

  it('refuses an expired token', () => {
    const expired = jwt.sign({ userId: 'user-123' }, config.jwt.secret, {
      ...jwtSignOptions,
      expiresIn: '-1s',
    });

    expect(rateLimitKey(req(`Bearer ${expired}`))).toBe('ip:203.0.113.7');
  });

  it('refuses a token minted for a different audience', () => {
    // An MFA challenge token is deliberately not a session token; it must not be a bucket key either.
    const mfaToken = jwt.sign({ userId: 'user-123', mfa: 'pending' }, config.jwt.secret, {
      algorithm: 'HS256',
      issuer: JWT_ISSUER,
      audience: JWT_MFA_AUDIENCE,
      expiresIn: '5m',
    });

    expect(rateLimitKey(req(`Bearer ${mfaToken}`))).toBe('ip:203.0.113.7');
  });

  it('refuses garbage in the token position', () => {
    expect(rateLimitKey(req('Bearer not-a-jwt'))).toBe('ip:203.0.113.7');
    expect(rateLimitKey(req('Bearer a.b.c'))).toBe('ip:203.0.113.7');
  });

  it('refuses a validly-signed token with no usable userId', () => {
    const noUser = jwt.sign({ familyId: 'fam-1' }, config.jwt.secret, {
      ...jwtSignOptions,
      expiresIn: '15m',
    });
    const emptyUser = jwt.sign({ userId: '' }, config.jwt.secret, {
      ...jwtSignOptions,
      expiresIn: '15m',
    });

    expect(rateLimitKey(req(`Bearer ${noUser}`))).toBe('ip:203.0.113.7');
    expect(rateLimitKey(req(`Bearer ${emptyUser}`))).toBe('ip:203.0.113.7');
  });
});

describe('namespacing', () => {
  it('cannot collide a user id with an IP address', () => {
    // Ids are cuid/uuid so this cannot happen today, but the collision would be silent if it did.
    const key = rateLimitKey(req(`Bearer ${validToken('203.0.113.7')}`));

    expect(key).toBe('u:203.0.113.7');
    expect(key).not.toBe(rateLimitKey(req(undefined, '203.0.113.7')));
  });
});
