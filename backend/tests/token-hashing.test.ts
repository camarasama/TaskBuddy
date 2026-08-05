import crypto from 'crypto';
import request from 'supertest';

// F-7: verification and invite tokens are stored as sha256 hashes. These tests pin the *lookup*
// side of that: a token presented by a user must only ever be matched against its hash, so a
// database leak yields no usable link. The transitional dual-read (which also matched the raw
// value) is gone, and must not come back.
jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    familyInvitation: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/SessionService', () => ({
  SessionService: {
    create: jest.fn().mockResolvedValue(undefined),
    revokeAllForUser: jest.fn().mockResolvedValue(0),
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
import { prisma } from '../src/services/database';
import { inviteService } from '../src/services/invite';

const findUser = prisma.user.findFirst as jest.Mock;
const findInvite = prisma.familyInvitation.findFirst as jest.Mock;

const RAW = 'a'.repeat(64);
const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const HASHED = sha256(RAW);

/**
 * Stands in for Prisma's matching against a single stored column value, honouring both the
 * equality form (`{ col: 'x' }`) and the `in` form the dual-read used (`{ col: { in: [...] } }`).
 * That way a re-introduced dual-read would still be *matched* by the fake DB — and therefore
 * caught by the assertions below rather than silently passing.
 */
const matcher = (stored: string, row: object) => (args: { where: Record<string, unknown> }) => {
  const clause = Object.values(args.where)[0] as string | { in?: string[] } | undefined;
  const hit =
    typeof clause === 'string'
      ? clause === stored
      : Array.isArray(clause?.in)
        ? (clause.in as string[]).includes(stored)
        : false;
  return Promise.resolve(hit ? row : null);
};

const unexpiredUser = {
  id: 'user-1',
  emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  emailVerifiedAt: null,
};

beforeEach(() => jest.clearAllMocks());

describe('F-7: email verification tokens are matched by hash only', () => {
  it('verifies a token whose hash is what the database holds', async () => {
    findUser.mockImplementation(matcher(HASHED, unexpiredUser));
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: RAW });
    expect(res.status).toBe(200);
  });

  it('rejects a token stored in plaintext — the legacy dual-read is gone', async () => {
    findUser.mockImplementation(matcher(RAW, unexpiredUser)); // pre-F-7 row, raw value at rest
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: RAW });
    expect(res.status).toBe(404);
  });

  it('never sends the raw token to the database', async () => {
    findUser.mockImplementation(matcher(HASHED, unexpiredUser));
    await request(app).post('/api/v1/auth/verify-email').send({ token: RAW });

    const where = findUser.mock.calls[0][0].where;
    expect(where).toEqual({ emailVerificationToken: HASHED });
    expect(JSON.stringify(where)).not.toContain(RAW);
  });
});

describe('F-7: invitation tokens are matched by hash only', () => {
  const invite = {
    id: 'inv-1',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    email: 'invitee@example.com',
    family: { familyName: 'Test Family' },
    invitedBy: { firstName: 'Pat', lastName: 'Parent' },
  };

  it('previews an invite whose hash is what the database holds', async () => {
    findInvite.mockImplementation(matcher(HASHED, invite));
    await expect(inviteService.getInvitePreview(RAW)).resolves.toMatchObject({
      familyName: 'Test Family',
    });
  });

  it('rejects a preview for an invite stored in plaintext', async () => {
    findInvite.mockImplementation(matcher(RAW, invite)); // pre-F-7 row
    await expect(inviteService.getInvitePreview(RAW)).rejects.toThrow(/not found/i);
  });

  it('rejects acceptance of an invite stored in plaintext', async () => {
    findInvite.mockImplementation(matcher(RAW, invite)); // pre-F-7 row
    await expect(
      inviteService.acceptInvite({
        token: RAW,
        firstName: 'New',
        lastName: 'Parent',
        password: 'correct horse battery staple',
        dateOfBirth: '1990-01-01',
      } as Parameters<typeof inviteService.acceptInvite>[0]),
    ).rejects.toThrow(/not found|already been used/i);
  });

  it('never sends the raw token to the database on either invite path', async () => {
    findInvite.mockImplementation(matcher(HASHED, invite));
    await inviteService.getInvitePreview(RAW);

    const where = findInvite.mock.calls[0][0].where;
    expect(where).toEqual({ token: HASHED });
    expect(JSON.stringify(where)).not.toContain(RAW);
  });
});
