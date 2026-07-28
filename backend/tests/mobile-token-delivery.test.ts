import request from 'supertest';

/**
 * P0-1 — native clients receive the refresh token in the JSON body, because React Native has no
 * cookie jar and a mobile session must survive an app restart.
 *
 * The companion suite (auth-refresh-token-body.test.ts) asserts the inverse for browsers, and that
 * pairing is the point: this change is only safe as long as the web path is byte-identical to
 * before. The web-regression case is repeated here deliberately — if someone widens the mobile
 * branch, this file should fail too rather than leaving the guarantee in one place.
 *
 * Same stubbing approach as the companion suite: route-level assertions with prisma, audit and
 * email mocked, and authService spied to return a known token trio.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    user: { update: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/utils/passwordBreach', () => ({ isPasswordBreached: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/SessionService', () => ({
  SessionService: { revokeByToken: jest.fn().mockResolvedValue(undefined) },
}));

import { app } from '../src/index';
import { authService } from '../src/services/auth';
import { SessionService } from '../src/services/SessionService';

const ANDROID = 'taskbuddy-android/1.0.0';
const REFRESH = 'refresh-SECRET-for-mobile';
const TOKENS = { accessToken: 'access-token-abc', refreshToken: REFRESH, expiresIn: 900 };
const USER = { id: 'user-1', familyId: 'family-1', email: 'pat@example.com', firstName: 'Pat', role: 'parent' };

/** Assert: token is in the body for the app to store, and NO refresh cookie was set. */
function expectRefreshInBodyNotCookie(res: request.Response) {
  expect(res.body.data.tokens).toHaveProperty('refreshToken', REFRESH);
  expect(res.body.data.tokens).toHaveProperty('accessToken', TOKENS.accessToken);

  const setCookie = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  expect(setCookie.find((c) => c.startsWith('refreshToken='))).toBeUndefined();
  // No refresh cookie means no ambient credential, so the CSRF pair is pointless here too.
  expect(setCookie.find((c) => c.startsWith('csrfToken='))).toBeUndefined();
}

describe('P0-1: mobile clients get the refresh token in the response body', () => {
  afterEach(() => jest.restoreAllMocks());

  it('POST /register', async () => {
    jest.spyOn(authService, 'register').mockResolvedValue({ family: { id: 'family-1' }, user: USER, tokens: TOKENS } as never);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .set('X-Client', ANDROID)
      .send({
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
    expectRefreshInBodyNotCookie(res);
  });

  it('POST /login', async () => {
    jest.spyOn(authService, 'login').mockResolvedValue({ user: USER, tokens: TOKENS } as never);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Client', ANDROID)
      .send({ email: 'pat@example.com', password: 'Password123!' });

    expect(res.status).toBe(200);
    expectRefreshInBodyNotCookie(res);
  });

  it('POST /child/login', async () => {
    jest
      .spyOn(authService, 'childLogin')
      .mockResolvedValue({ user: { ...USER, role: 'child' }, profile: { id: 'profile-1' }, tokens: TOKENS } as never);

    const res = await request(app)
      .post('/api/v1/auth/child/login')
      .set('X-Client', ANDROID)
      .send({ familyCode: 'BRAVE-OTTER-4417', childIdentifier: 'sam', pin: '1234' });

    expect(res.status).toBe(200);
    expectRefreshInBodyNotCookie(res);
  });

  it('POST /refresh accepts the token in the body and returns the rotated one there', async () => {
    jest.spyOn(authService, 'refreshToken').mockResolvedValue(TOKENS as never);

    // No cookie at all: the app sends the stored token explicitly. requireCsrf exempts this path
    // because an explicit credential is not a CSRF vector.
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .set('X-Client', ANDROID)
      .send({ refreshToken: 'stored-token-from-secure-store' });

    expect(res.status).toBe(200);
    expectRefreshInBodyNotCookie(res);
  });

  it('POST /logout revokes the session for a body-supplied token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('X-Client', ANDROID)
      .send({ refreshToken: 'stored-token-from-secure-store' });

    expect(res.status).toBe(200);
    expect(SessionService.revokeByToken).toHaveBeenCalledWith('stored-token-from-secure-store', 'logout');
  });
});

describe('P0-1: the web path is unchanged — only a known native platform opts in', () => {
  afterEach(() => jest.restoreAllMocks());

  /** Assert the browser guarantee (F-2): cookie only, never in the body. */
  function expectWebBehaviour(res: request.Response) {
    const setCookie = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
    const refreshCookie = setCookie.find((c) => c.startsWith('refreshToken='));

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(JSON.stringify(res.body)).not.toContain(REFRESH);
    expect(res.body.data.tokens).not.toHaveProperty('refreshToken');
  }

  async function login(header?: string) {
    jest.spyOn(authService, 'login').mockResolvedValue({ user: USER, tokens: TOKENS } as never);
    const req = request(app).post('/api/v1/auth/login');
    if (header !== undefined) req.set('X-Client', header);
    return req.send({ email: 'pat@example.com', password: 'Password123!' });
  }

  it('no X-Client header at all (every browser)', async () => {
    expectWebBehaviour(await login());
  });

  it.each([
    ['an unknown platform', 'taskbuddy-web/1.0.0'],
    ['a malformed version', 'taskbuddy-android/banana'],
    ['a platform with no version', 'taskbuddy-android'],
    ['an empty header', ''],
    ['a header that merely contains the platform name', 'Mozilla/5.0 taskbuddy-android/1.0.0'],
  ])('%s is treated as web', async (_label, header) => {
    expectWebBehaviour(await login(header));
  });
});
