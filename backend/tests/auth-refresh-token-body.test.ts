import request from 'supertest';

// The refresh token must reach the browser ONLY as an HttpOnly cookie, never in a JSON body
// where XSS could read it (F-2). These are route-level assertions, so the real auth/crypto is
// stubbed: prisma, audit, and email are mocked out, and authService methods are spied to return
// a known token trio whose refresh value we then hunt for in each response body.
jest.mock('../src/services/database', () => ({
  prisma: {
    user: { update: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn().mockResolvedValue(undefined) },
}));

import { app } from '../src/index';
import { authService } from '../src/services/auth';

// A recognisable secret we assert never appears in any response body.
const REFRESH = 'refresh-SECRET-must-not-leak';
const TOKENS = { accessToken: 'access-token-abc', refreshToken: REFRESH, expiresIn: 900 };
const USER = { id: 'user-1', familyId: 'family-1', email: 'pat@example.com', firstName: 'Pat', role: 'parent' };

/** Assert: refresh token is in the Set-Cookie (HttpOnly), and nowhere in the JSON body. */
function expectRefreshCookieButNotBody(res: request.Response) {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const refreshCookie = (setCookie ?? []).find((c) => c.startsWith('refreshToken='));

  expect(refreshCookie).toBeDefined();
  expect(refreshCookie).toContain(REFRESH);
  expect(refreshCookie).toMatch(/HttpOnly/i);

  // The strongest form of "no refreshToken key anywhere in the body": the value never appears.
  expect(JSON.stringify(res.body)).not.toContain(REFRESH);
  expect(res.body.data.tokens).toHaveProperty('accessToken', TOKENS.accessToken);
  expect(res.body.data.tokens).not.toHaveProperty('refreshToken');
}

describe('auth routes deliver the refresh token by cookie only, never in the body (F-2)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('POST /register', async () => {
    jest.spyOn(authService, 'register').mockResolvedValue({ family: { id: 'family-1' }, user: USER, tokens: TOKENS } as never);

    const res = await request(app).post('/api/v1/auth/register').send({
      familyName: 'The Testers',
      parent: {
        firstName: 'Pat',
        lastName: 'Tester',
        email: 'pat@example.com',
        password: 'Password123!',
        dateOfBirth: '1990-01-01',
      },
    });

    expect(res.status).toBe(201);
    expectRefreshCookieButNotBody(res);
  });

  it('POST /login', async () => {
    jest.spyOn(authService, 'login').mockResolvedValue({ user: USER, tokens: TOKENS } as never);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'pat@example.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expectRefreshCookieButNotBody(res);
  });

  it('POST /child/login', async () => {
    jest
      .spyOn(authService, 'childLogin')
      .mockResolvedValue({ user: { ...USER, role: 'child' }, profile: { id: 'profile-1' }, tokens: TOKENS } as never);

    const res = await request(app)
      .post('/api/v1/auth/child/login')
      .send({ familyCode: 'BRAVE-OTTER-4417', childIdentifier: 'sam', pin: '1234' });

    expect(res.status).toBe(200);
    expectRefreshCookieButNotBody(res);
  });

  it('POST /refresh', async () => {
    jest.spyOn(authService, 'refreshToken').mockResolvedValue(TOKENS as never);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', ['refreshToken=some-old-cookie-token'])
      .send({});

    expect(res.status).toBe(200);
    expectRefreshCookieButNotBody(res);
  });
});
