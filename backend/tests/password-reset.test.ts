import crypto from 'crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';

// Mock the collaborators so the reset logic can be exercised without a database, SMTP, or the
// real session store. Only the pieces these tests assert on are provided.
jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/SessionService', () => ({
  SessionService: {
    create: jest.fn().mockResolvedValue(undefined),
    revokeAllForUser: jest.fn().mockResolvedValue(2),
    revokeByToken: jest.fn().mockResolvedValue(undefined),
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
import { prisma } from '../src/services/database';
import { SessionService } from '../src/services/SessionService';
import { AuditService } from '../src/services/AuditService';

const findUser = prisma.user.findFirst as jest.Mock;
const updateUser = prisma.user.update as jest.Mock;
const revokeAll = SessionService.revokeAllForUser as jest.Mock;
const logAction = AuditService.logAction as jest.Mock;

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');

beforeEach(() => jest.clearAllMocks());

describe('AuthService.createPasswordResetToken', () => {
  it('returns null and stores nothing for an unknown / non-parent / inactive email', async () => {
    findUser.mockResolvedValue(null);

    const result = await authService.createPasswordResetToken('nobody@example.com');

    expect(result).toBeNull();
    expect(updateUser).not.toHaveBeenCalled(); // no token written → nothing to enumerate
  });

  it('stores only the sha256 of a fresh token with a future expiry, and returns the raw token', async () => {
    findUser.mockResolvedValue({ id: 'u1', email: 'pat@example.com', firstName: 'Pat', familyId: 'f1' });

    const result = await authService.createPasswordResetToken('pat@example.com');

    expect(result).not.toBeNull();
    expect(result!.token).toMatch(/^[a-f0-9]{64}$/); // 32 random bytes, hex

    const data = updateUser.mock.calls[0][0].data;
    expect(data.passwordResetTokenHash).toBe(sha256(result!.token)); // hashed at rest, never raw
    expect(data.passwordResetTokenHash).not.toBe(result!.token);
    expect(new Date(data.passwordResetExpiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe('AuthService.resetPassword', () => {
  const futureExpiry = () => new Date(Date.now() + 30 * 60_000);

  it('sets the new password, clears the reset fields, revokes all sessions, and audits', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      role: 'parent',
      familyId: 'f1',
      passwordResetExpiresAt: futureExpiry(),
    });

    await authService.resetPassword('the-token', 'NewPassw0rd!', { ip: '1.2.3.4' });

    const data = updateUser.mock.calls[0][0].data;
    expect(await bcrypt.compare('NewPassw0rd!', data.passwordHash)).toBe(true);
    expect(data.passwordResetTokenHash).toBeNull();
    expect(data.passwordResetExpiresAt).toBeNull();

    expect(revokeAll).toHaveBeenCalledWith('u1', 'password_change');
    expect(logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'PASSWORD_RESET', actorId: 'u1' }));
  });

  it('rejects an expired token and changes nothing', async () => {
    findUser.mockResolvedValue({
      id: 'u1',
      role: 'parent',
      familyId: 'f1',
      passwordResetExpiresAt: new Date(Date.now() - 1000),
    });

    await expect(authService.resetPassword('t', 'NewPassw0rd!')).rejects.toThrow(/invalid or expired/i);
    expect(updateUser).not.toHaveBeenCalled();
    expect(revokeAll).not.toHaveBeenCalled();
  });

  it('rejects an unknown token', async () => {
    findUser.mockResolvedValue(null);
    await expect(authService.resetPassword('t', 'NewPassw0rd!')).rejects.toThrow(/invalid or expired/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('refuses to reset a non-parent account (children use PINs)', async () => {
    findUser.mockResolvedValue({ id: 'c1', role: 'child', familyId: 'f1', passwordResetExpiresAt: futureExpiry() });
    await expect(authService.resetPassword('t', 'NewPassw0rd!')).rejects.toThrow(/invalid or expired/i);
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('POST /auth/forgot-password (anti-enumeration + rate limit)', () => {
  it('always returns 200 with a generic message for an unknown email', async () => {
    const spy = jest.spyOn(authService, 'createPasswordResetToken').mockResolvedValue(null);

    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'ghost@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toMatch(/if an account exists/i);
    spy.mockRestore();
  });

  it('stops calling the lookup after 3 requests for the same email within the window', async () => {
    const spy = jest.spyOn(authService, 'createPasswordResetToken').mockResolvedValue(null);
    const email = `rate-${Date.now()}@example.com`; // unique key so the in-memory limiter is fresh

    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/v1/auth/forgot-password').send({ email });
      expect(res.status).toBe(200);
    }
    // 4th is still 200 (no enumeration signal) but is short-circuited before the lookup.
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email });
    expect(res.status).toBe(200);

    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });
});
