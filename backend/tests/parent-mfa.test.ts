import bcrypt from 'bcrypt';
import request from 'supertest';
import { authenticator } from 'otplib';

/**
 * FR-17 — parent two-factor auth. The TOTP machinery (encrypted secret, setup/confirm/challenge)
 * was built for admins in F-9; FR-17 opens it to parents and adds a code-confirmed disable. These
 * tests pin: a parent can enrol, the login challenge fires for a parent, disable requires a valid
 * code, an admin cannot disable when it's mandatory, and children still cannot enrol.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
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
import { config } from '../src/config';
import { prisma } from '../src/services/database';
import { SessionService } from '../src/services/SessionService';
import { encryptSecret } from '../src/utils/mfa';

const findUnique = prisma.user.findUnique as jest.Mock;
const update = prisma.user.update as jest.Mock;
const sessionCreate = SessionService.create as jest.Mock;

function parentUser(over: Record<string, unknown> = {}) {
  return {
    id: 'par1', role: 'parent', email: 'parent@example.com', passwordHash: 'hash',
    familyId: 'fam1', lockedUntil: null, failedLoginAttempts: 0, lastFailedLoginAt: null,
    isActive: true, deletedAt: null, emailVerifiedAt: new Date(),
    mfaEnabledAt: null, mfaSecret: null, childProfile: null, family: { isSuspended: false }, ...over,
  };
}

const wrongCode = (secret: string) => {
  const valid = authenticator.generate(secret);
  return (valid[0] === '0' ? '1' : '0') + valid.slice(1);
};

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.user.count as jest.Mock).mockResolvedValue(0);
  jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
});
afterEach(() => jest.restoreAllMocks());

describe('FR-17: a parent can enrol in 2FA', () => {
  it('setupMfa works for a parent (was admin-only)', async () => {
    findUnique.mockResolvedValue(parentUser());
    const { otpauthUrl } = await authService.setupMfa('par1');
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    expect(update.mock.calls[0][0].data.mfaSecret).toContain(':');
    expect(update.mock.calls[0][0].data.mfaEnabledAt).toBeNull();
  });

  it('confirmMfa enables it for a valid code', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue(parentUser({ mfaSecret: encryptSecret(secret) }));
    await authService.confirmMfa('par1', authenticator.generate(secret));
    expect(update.mock.calls[0][0].data.mfaEnabledAt).toBeInstanceOf(Date);
  });

  it('a CHILD still cannot enrol', async () => {
    findUnique.mockResolvedValue(parentUser({ id: 'kid1', role: 'child' }));
    await expect(authService.setupMfa('kid1')).rejects.toThrow(/parents and admins/i);
  });
});

describe('FR-17: the login challenge fires for an enrolled parent', () => {
  it('an enrolled parent gets mfaRequired + token, no session', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue(
      parentUser({ mfaEnabledAt: new Date(), mfaSecret: encryptSecret(secret) }),
    );

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'parent@example.com', password: 'password123' });

    expect(res.body.data.mfaRequired).toBe(true);
    expect(res.body.data.mfaToken).toBeTruthy();
    expect(res.body.data.tokens).toBeUndefined();
    expect(sessionCreate).not.toHaveBeenCalled();
  });

  it('a parent WITHOUT 2FA still logs in normally', async () => {
    findUnique.mockResolvedValue(parentUser({ mfaEnabledAt: null }));
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'parent@example.com', password: 'password123' });
    expect(res.body.data.mfaRequired).toBeUndefined();
    expect(res.body.data.tokens.accessToken).toBeTruthy();
  });
});

describe('FR-17: disable requires a valid code', () => {
  it('disables when the code is correct', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue(
      parentUser({ mfaEnabledAt: new Date(), mfaSecret: encryptSecret(secret) }),
    );
    await authService.disableMfa('par1', authenticator.generate(secret));
    const data = update.mock.calls[0][0].data;
    expect(data.mfaSecret).toBeNull();
    expect(data.mfaEnabledAt).toBeNull();
  });

  it('refuses a wrong code and leaves 2FA on', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue(
      parentUser({ mfaEnabledAt: new Date(), mfaSecret: encryptSecret(secret) }),
    );
    await expect(authService.disableMfa('par1', wrongCode(secret))).rejects.toThrow(/invalid/i);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('FR-17: an admin cannot disable when 2FA is mandatory', () => {
  const mfaCfg = config.mfa as { required: boolean };
  const originalRequired = mfaCfg.required;
  afterEach(() => { mfaCfg.required = originalRequired; });

  it('blocks disable while config.mfa.required is true', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue({
      id: 'adm1', role: 'admin', mfaEnabledAt: new Date(), mfaSecret: encryptSecret(secret),
    });
    mfaCfg.required = true;

    await expect(authService.disableMfa('adm1', authenticator.generate(secret))).rejects.toThrow(
      /mandatory/i,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('lets an admin disable when it is NOT mandatory (grace period)', async () => {
    const secret = authenticator.generateSecret();
    findUnique.mockResolvedValue({
      id: 'adm1', role: 'admin', mfaEnabledAt: new Date(), mfaSecret: encryptSecret(secret),
    });
    mfaCfg.required = false;

    await authService.disableMfa('adm1', authenticator.generate(secret));
    expect(update.mock.calls[0][0].data.mfaEnabledAt).toBeNull();
  });
});
