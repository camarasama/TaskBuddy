import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import request from 'supertest';

jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findFirst: jest.fn() },
    user: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    refreshSession: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn(),
  },
}));

import { app } from '../src/index';
import { authenticate } from '../src/middleware/auth';
import { authService } from '../src/services/auth';
import { prisma } from '../src/services/database';
import { jwtSignOptions } from '../src/utils/jwt';
import { hashToken } from '../src/utils/tokens';

const SECRET = process.env.JWT_SECRET as string; // dummy provided by jest.setup
const payload = { userId: 'u1', familyId: 'f1', role: 'parent' };

function runAuth(token?: string) {
  const req: any = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const next = jest.fn();
  authenticate(req, {} as any, next);
  return { req, next };
}

describe('authenticate() pins algorithm + issuer + audience (F-6)', () => {
  it('accepts a token minted with the pinned sign options', () => {
    const token = jwt.sign(payload, SECRET, { ...jwtSignOptions, expiresIn: '1h' });
    const { req, next } = runAuth(token);
    expect(next).toHaveBeenCalledWith(); // no error
    expect(req.user.userId).toBe('u1');
  });

  it('rejects a token that lacks the issuer/audience claims', () => {
    const token = jwt.sign(payload, SECRET, { expiresIn: '1h' }); // valid signature, no iss/aud
    const { next } = runAuth(token);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next.mock.calls[0][0].message).toMatch(/invalid token/i);
  });

  it('rejects an unsigned (alg:none) token', () => {
    const token = jwt.sign(payload, '', {
      algorithm: 'none',
      issuer: 'taskbuddy-api',
      audience: 'taskbuddy',
    });
    const { next } = runAuth(token);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('rejects when no token is supplied', () => {
    const { next } = runAuth();
    expect(next.mock.calls[0][0].message).toMatch(/no authentication token/i);
  });
});

describe('childLogin closes the family-code disclosure (F-10d)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns the generic error for an unknown family and still runs bcrypt', async () => {
    (prisma.family.findFirst as jest.Mock).mockResolvedValue(null);
    const compareSpy = jest.spyOn(bcrypt, 'compare');

    await expect(
      authService.childLogin({ familyCode: 'NOPE-NOPE-0000', childIdentifier: 'sam', pin: '1234' }),
    ).rejects.toThrow(/invalid credentials/i);

    // Timing is equalised: the dummy compare runs even when the family does not exist.
    expect(compareSpy).toHaveBeenCalled();
  });
});

describe('verification token is looked up by hash (F-7)', () => {
  it('POST /verify-email queries the hashed token (with a legacy raw fallback)', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null); // not found → 404, we assert the where
    const raw = 'raw-verification-token-xyz';

    await request(app).post('/api/v1/auth/verify-email').send({ token: raw });

    const where = (prisma.user.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(where.emailVerificationToken.in).toContain(hashToken(raw)); // hashed at rest
    expect(where.emailVerificationToken.in).toContain(raw); // dual-read for pre-existing tokens
  });
});
