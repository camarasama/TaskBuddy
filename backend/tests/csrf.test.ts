import request from 'supertest';

/**
 * FR-02. CSRF protection is scoped to the only two endpoints that authenticate from the ambient
 * `refreshToken` cookie. In production that cookie is SameSite=None (the app and API live on
 * different subdomains), so without this any site could force a logout or drive a refresh.
 */
jest.mock('../src/services/database', () => ({
  prisma: { user: { findFirst: jest.fn(), findUnique: jest.fn() }, $queryRaw: jest.fn() },
}));
jest.mock('../src/services/SessionService', () => ({
  SessionService: {
    revokeByToken: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue(undefined),
    rotate: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn().mockResolvedValue(undefined) },
}));

import { app } from '../src/index';
import { SessionService } from '../src/services/SessionService';

const revokeByToken = SessionService.revokeByToken as jest.Mock;

beforeEach(() => jest.clearAllMocks());

/** Pull a cookie's value out of a Set-Cookie header array. */
function cookieValue(setCookie: string[] | undefined, name: string): string | null {
  const hit = (setCookie ?? []).find((c) => c.startsWith(`${name}=`));
  if (!hit) return null;
  return hit.split(';')[0].split('=').slice(1).join('=');
}

describe('GET /auth/csrf-token', () => {
  it('issues a token in both a readable cookie and the body, and they match', async () => {
    const res = await request(app).get('/api/v1/auth/csrf-token');

    expect(res.status).toBe(200);
    const cookie = cookieValue(res.headers['set-cookie'] as unknown as string[], 'csrfToken');
    expect(cookie).toBeTruthy();
    expect(res.body.data.csrfToken).toBe(cookie);
  });

  it('sets the CSRF cookie WITHOUT HttpOnly — the client must be able to echo it', async () => {
    const res = await request(app).get('/api/v1/auth/csrf-token');
    const raw = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('csrfToken='),
    )!;
    expect(raw.toLowerCase()).not.toContain('httponly');
  });

  it('issues a different token each call', async () => {
    const a = await request(app).get('/api/v1/auth/csrf-token');
    const b = await request(app).get('/api/v1/auth/csrf-token');
    expect(a.body.data.csrfToken).not.toBe(b.body.data.csrfToken);
  });
});

describe('POST /auth/logout is CSRF-protected (FR-02)', () => {
  it('rejects a refresh cookie with NO CSRF header — the forged-request case', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', ['refreshToken=stolen-or-ambient']);

    expect(res.status).toBe(403);
    expect(revokeByToken).not.toHaveBeenCalled(); // the session must survive a forged logout
  });

  it('rejects a mismatched CSRF header', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', ['refreshToken=abc', 'csrfToken=' + 'a'.repeat(64)])
      .set('X-CSRF-Token', 'b'.repeat(64));

    expect(res.status).toBe(403);
    expect(revokeByToken).not.toHaveBeenCalled();
  });

  it('rejects a header that is a prefix of the cookie (no partial match)', async () => {
    const token = 'a'.repeat(64);
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', ['refreshToken=abc', `csrfToken=${token}`])
      .set('X-CSRF-Token', token.slice(0, 32));

    expect(res.status).toBe(403);
  });

  it('accepts a matching header + cookie pair', async () => {
    const token = 'c'.repeat(64);
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', ['refreshToken=abc', `csrfToken=${token}`])
      .set('X-CSRF-Token', token);

    expect(res.status).toBe(200);
    expect(revokeByToken).toHaveBeenCalledWith('abc', 'logout');
  });

  it('clears the CSRF cookie on logout', async () => {
    const token = 'd'.repeat(64);
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Cookie', ['refreshToken=abc', `csrfToken=${token}`])
      .set('X-CSRF-Token', token);

    const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('csrfToken='),
    );
    expect(cleared).toBeTruthy();
    expect(cookieValue(res.headers['set-cookie'] as unknown as string[], 'csrfToken')).toBe('');
  });
});

describe('POST /auth/refresh is CSRF-protected (FR-02)', () => {
  it('rejects a refresh driven purely by the ambient cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', ['refreshToken=ambient'])
      .send({});

    expect(res.status).toBe(403);
  });
});

describe('CSRF does not apply where there is no ambient credential', () => {
  it('exempts a body-supplied refresh token (the documented mobile path)', async () => {
    // No refreshToken cookie → not a CSRF vector, so the guard must not block it. It will fail
    // later on the token itself; the point is that it is NOT a 403 from the CSRF layer.
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'explicit-not-ambient' });

    expect(res.status).not.toBe(403);
  });

  it('leaves Bearer-authenticated endpoints alone (GET /auth/me needs no CSRF token)', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    // 401 for missing/!invalid bearer — never 403 from the CSRF guard.
    expect(res.status).toBe(401);
  });
});
