import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { authenticator } from 'otplib';

jest.mock('../src/services/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    family: { findUnique: jest.fn().mockResolvedValue({ isSuspended: false }) },
    familySettings: { findUnique: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/SessionService', () => ({
  SessionService: { create: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn().mockResolvedValue(undefined) },
}));

import { app } from '../src/index';
import { authService } from '../src/services/auth';
import { prisma } from '../src/services/database';
import { SessionService } from '../src/services/SessionService';
import { encryptSecret } from '../src/utils/mfa';
import { signMfaToken } from '../src/utils/jwt';
import { jwtSignOptions } from '../src/utils/jwt';

const SECRET = process.env.JWT_SECRET as string;
const findUnique = prisma.user.findUnique as jest.Mock;
const update = prisma.user.update as jest.Mock;
const count = prisma.user.count as jest.Mock;
const create = prisma.user.create as jest.Mock;
const sessionCreate = SessionService.create as jest.Mock;

function adminUser(over: Record<string, unknown> = {}) {
  return {
    id: 'adm1', role: 'admin', email: 'admin@example.com', passwordHash: 'hash',
    familyId: null, lockedUntil: null, failedLoginAttempts: 0, lastFailedLoginAt: null,
    mfaEnabledAt: null, mfaSecret: null, childProfile: null, family: null, ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  count.mockResolvedValue(0);
  (prisma.user.findMany as jest.Mock).mockResolvedValue([]);
  jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never); // password always "correct"
});
afterEach(() => jest.restoreAllMocks());

describe('MFA enrollment (F-9)', () => {
  it('setupMfa stores an encrypted, still-disabled secret and returns an otpauth URL', async () => {
    findUnique.mockResolvedValue(adminUser());
    const { otpauthUrl } = await authService.setupMfa('adm1');
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const data = update.mock.calls[0][0].data;
    expect(data.mfaSecret).toContain(':');        // iv:tag:ciphertext
    expect(data.mfaEnabledAt).toBeNull();          // not enabled until a code is verified
  });

  it('confirmMfa enables MFA for a valid code and rejects an invalid one', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue(adminUser({ mfaSecret: encryptSecret(secret) }));

    await authService.confirmMfa('adm1', authenticator.generate(secret));
    expect(update.mock.calls[0][0].data.mfaEnabledAt).toBeInstanceOf(Date);

    const valid = authenticator.generate(secret);
    const wrong = (valid[0] === '0' ? '1' : '0') + valid.slice(1); // guaranteed-different 6 digits
    await expect(authService.confirmMfa('adm1', wrong)).rejects.toThrow(/invalid/i);
  });
});

describe('MFA login gate (F-9)', () => {
  it('an enrolled admin gets mfaRequired + a challenge token, and NO session', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue(adminUser({ mfaEnabledAt: new Date(), mfaSecret: encryptSecret(secret) }));

    const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@example.com', password: 'password1' });

    expect(res.body.data.mfaRequired).toBe(true);
    expect(res.body.data.mfaToken).toBeTruthy();
    expect(res.body.data.tokens).toBeUndefined();
    expect(sessionCreate).not.toHaveBeenCalled(); // no refresh session minted yet
  });

  it('an admin WITHOUT MFA logs in normally (grace period)', async () => {
    findUnique.mockResolvedValue(adminUser({ mfaEnabledAt: null }));
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@example.com', password: 'password1' });
    expect(res.body.data.mfaRequired).toBeUndefined();
    expect(res.body.data.tokens.accessToken).toBeTruthy();
  });

  it('POST /mfa/challenge exchanges a valid code for real tokens', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue(adminUser({ mfaEnabledAt: new Date(), mfaSecret: encryptSecret(secret) }));

    const res = await request(app)
      .post('/api/v1/auth/mfa/challenge')
      .send({ mfaToken: signMfaToken('adm1', SECRET), code: authenticator.generate(secret) });

    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(sessionCreate).toHaveBeenCalled();
  });

  it('POST /mfa/challenge rejects a wrong code', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue(adminUser({ mfaEnabledAt: new Date(), mfaSecret: encryptSecret(secret) }));
    const valid = authenticator.generate(secret);
    const wrong = (valid[0] === '0' ? '1' : '0') + valid.slice(1);

    const res = await request(app)
      .post('/api/v1/auth/mfa/challenge')
      .send({ mfaToken: signMfaToken('adm1', SECRET), code: wrong });

    expect(res.status).toBe(401);
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('a challenge token cannot be used as a session token (audience pinned)', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${signMfaToken('adm1', SECRET)}`);
    expect(res.status).toBe(401);
  });
});

describe('admin invite hardening (F-9)', () => {
  const body = { email: 'new@example.com', password: 'password1', firstName: 'New', lastName: 'Admin', inviteCode: process.env.ADMIN_INVITE_CODE };

  it('with an admin already present, the invite code alone is rejected (403)', async () => {
    count.mockResolvedValue(1);
    const res = await request(app).post('/api/v1/auth/admin/register').send(body);
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('with a valid admin session, registration succeeds (201)', async () => {
    count.mockResolvedValue(1);
    findUnique.mockResolvedValue(null); // email is free (registerAdmin check)
    create.mockResolvedValue({ id: 'new1', email: 'new@example.com', firstName: 'New', lastName: 'Admin', role: 'admin', familyId: null });

    const adminJwt = jwt.sign({ userId: 'adm1', familyId: null, role: 'admin' }, SECRET, { ...jwtSignOptions, expiresIn: '1h' });
    const res = await request(app)
      .post('/api/v1/auth/admin/register')
      .set('Authorization', `Bearer ${adminJwt}`)
      .send(body);

    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalled();
  });

  it('bootstraps the FIRST admin on the invite code alone (no admins yet)', async () => {
    count.mockResolvedValue(0);
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: 'first', email: 'new@example.com', firstName: 'New', lastName: 'Admin', role: 'admin', familyId: null });
    const res = await request(app).post('/api/v1/auth/admin/register').send(body);
    expect(res.status).toBe(201);
  });
});
