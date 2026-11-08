import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * The public demo family (services/demoAccount.ts). Its logins are posted on launch sites, so the
 * guard must refuse what would lock visitors out, delete the account, send email to typed
 * addresses or upload files, while leaving the product itself usable. And it must never touch a
 * real family.
 */
const familyFindUnique = jest.fn();
const emailLogCreate = jest.fn();
jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findUnique: (...a: unknown[]) => familyFindUnique(...a) },
    emailLog: { create: (...a: unknown[]) => emailLogCreate(...a) },
    user: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn(),
  },
}));

import { app } from '../src/index';
import { config } from '../src/config';
import { jwtSignOptions } from '../src/utils/jwt';
import { isBlockedForDemo, isDemoFamily, clearDemoFamilyCache } from '../src/services/demoAccount';
import { EmailService } from '../src/services/email';

const DEMO = 'demo-family';
const REAL = 'real-family';

function token(familyId: string, role = 'parent'): string {
  return jwt.sign({ userId: 'u1', familyId, role }, config.jwt.secret, { ...jwtSignOptions, expiresIn: '5m' });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearDemoFamilyCache();
  familyFindUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve({ isDemoAccount: where.id === DEMO }),
  );
});

describe('isBlockedForDemo', () => {
  it.each([
    ['PUT', '/auth/password'],
    ['PUT', '/auth/me'],
    ['POST', '/auth/mfa/enable'],
    ['POST', '/auth/child/pin/setup'],
    ['POST', '/auth/family/regenerate-code'],
    ['PUT', '/families/me/children/abc'],
    ['DELETE', '/families/me/children/abc'],
    ['POST', '/families/me/children'],
    ['POST', '/families/me/deletion'],
    ['PUT', '/families/me'],
    ['POST', '/families/me/invite'],
    ['POST', '/auth/upload-image'],
    ['POST', '/families/me/my-avatar-photo'],
    ['POST', '/tasks/assignments/abc/upload'],
    ['POST', '/webhooks'],
    ['GET', '/sessions'],
    ['DELETE', '/sessions/children/abc'],
    ['GET', '/reports/audit-trail'],
    ['GET', '/families/me/export'],
    ['POST', '/notifications/push/subscribe'],
    // Express routes case-insensitively and ignores a trailing slash: so must the list.
    ['PUT', '/AUTH/Password/'],
  ])('blocks %s %s', (method, path) => {
    expect(isBlockedForDemo(method, path)).toBe(true);
  });

  it.each([
    ['POST', '/tasks'],
    ['PUT', '/tasks/assignments/abc/complete'],
    ['PUT', '/tasks/assignments/abc/approve'],
    ['POST', '/tasks/assignments/abc/comments'],
    ['POST', '/rewards'],
    ['POST', '/rewards/abc/redeem'],
    ['POST', '/games/sessions'],
    ['POST', '/challenges/abc/complete'],
    ['PUT', '/families/me/settings'],
    ['GET', '/families/me'],
    ['GET', '/families/me/children/abc'],
    ['GET', '/webhooks'],
    ['POST', '/auth/login'],
    ['POST', '/auth/child/login'],
    ['POST', '/auth/refresh'],
    ['POST', '/auth/logout'],
  ])('allows %s %s', (method, path) => {
    expect(isBlockedForDemo(method, path)).toBe(false);
  });
});

describe('demoGuard on the real app', () => {
  it('refuses a blocked route for the demo family with DEMO_READ_ONLY', async () => {
    const res = await request(app)
      .put('/api/v1/auth/password')
      .set('Authorization', `Bearer ${token(DEMO)}`)
      .send({ currentPassword: 'x', newPassword: 'y' });

    expect(res.status).toBe(403);
    expect(res.body.error?.code ?? res.body.code).toBe('DEMO_READ_ONLY');
  });

  it('refuses it for a demo child too', async () => {
    const res = await request(app)
      .get('/api/v1/sessions')
      .set('Authorization', `Bearer ${token(DEMO, 'child')}`);
    expect(res.status).toBe(403);
  });

  it('never blocks a real family', async () => {
    const res = await request(app)
      .put('/api/v1/auth/password')
      .set('Authorization', `Bearer ${token(REAL)}`)
      .send({ currentPassword: 'x', newPassword: 'y' });

    expect(JSON.stringify(res.body)).not.toContain('DEMO_READ_ONLY');
  });

  it('leaves authentication to the route: no token stays a 401', async () => {
    const res = await request(app).put('/api/v1/auth/password').send({});
    expect(res.status).toBe(401);
    expect(familyFindUnique).not.toHaveBeenCalled();
  });

  it('does not look the family up for an allowed route', async () => {
    // The API index reads nothing itself, so any lookup here would be the guard's.
    await request(app).get('/api/v1/').set('Authorization', `Bearer ${token(DEMO)}`);
    expect(familyFindUnique).not.toHaveBeenCalled();
  });
});

describe('isDemoFamily', () => {
  it('fails open, so a database error never blocks a real family', async () => {
    familyFindUnique.mockRejectedValueOnce(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(isDemoFamily(DEMO)).resolves.toBe(false);
  });

  it('caches the answer', async () => {
    await isDemoFamily(DEMO);
    await isDemoFamily(DEMO);
    expect(familyFindUnique).toHaveBeenCalledTimes(1);
  });
});

describe('EmailService for the demo family', () => {
  it('suppresses every email, security email included, and logs nothing', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const result = await EmailService.send({
      triggerType: 'password_reset',
      toEmail: 'demo@gettaskbuddy.com',
      toUserId: 'u1',
      familyId: DEMO,
      subject: 'Reset your TaskBuddy password',
      templateData: {},
      skipPreferenceCheck: true,
    } as Parameters<typeof EmailService.send>[0]);

    expect(result).toBe('suppressed');
    expect(emailLogCreate).not.toHaveBeenCalled();
  });
});
