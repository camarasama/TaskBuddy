/**
 * Who may still use a family account that is scheduled for deletion.
 *
 * The answer is asymmetric and the asymmetry is the point: parents keep working, because a parent is
 * the only one who can cancel, and locking them out would strand the account until the purge ran.
 * Children are refused immediately, because the alternative is a child earning points against data
 * with a destruction date on it.
 *
 * `childLogin` already refuses (it resolves the family with `deletedAt: null`), but that only stops
 * NEW sessions. A child holding a live access token would carry on until it expired, which is what
 * the middleware closes.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

import type { NextFunction, Request, Response } from 'express';

import { familyIsolation } from '../src/middleware/auth';
import { prisma } from '../src/services/database';

const findFamily = prisma.family.findUnique as jest.Mock;
const findUser = prisma.user.findUnique as jest.Mock;

function request(role: 'parent' | 'child'): Request {
  return {
    user: { userId: 'u1', familyId: 'fam1', role },
    params: {},
    body: {},
    query: {},
  } as unknown as Request;
}

/** `familyIsolation` calls next() from inside a promise chain, so the assertion has to wait. */
function run(req: Request): Promise<unknown> {
  return new Promise((resolve) => {
    familyIsolation(req, {} as Response, ((err?: unknown) => resolve(err)) as NextFunction);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Parents also pass an email-verification gate in this middleware.
  findUser.mockResolvedValue({ emailVerifiedAt: new Date() });
});

describe('a family scheduled for deletion', () => {
  beforeEach(() => {
    findFamily.mockResolvedValue({ isSuspended: false, deletedAt: new Date() });
  });

  it('refuses a child, with a code the app can act on', async () => {
    const err = (await run(request('child'))) as { statusCode: number; code: string };

    expect(err).toBeDefined();
    expect(err.statusCode).toBe(403);
    // Distinct from a generic 403 so the app can explain the real reason rather than guessing.
    expect(err.code).toBe('ACCOUNT_PENDING_DELETION');
  });

  it('lets a parent through, because only a parent can cancel', async () => {
    await expect(run(request('parent'))).resolves.toBeUndefined();
  });
});

describe('a healthy family', () => {
  beforeEach(() => {
    findFamily.mockResolvedValue({ isSuspended: false, deletedAt: null });
  });

  it('lets a child through', async () => {
    await expect(run(request('child'))).resolves.toBeUndefined();
  });
});

describe('suspension still takes precedence', () => {
  it('refuses a parent in a suspended family, deletion or not', async () => {
    // Suspension is an admin action against the family; deletion is the family's own choice. A
    // suspended account must not become usable just because someone scheduled its deletion.
    findFamily.mockResolvedValue({ isSuspended: true, deletedAt: new Date() });

    const err = (await run(request('parent'))) as { message: string };

    expect(err).toBeDefined();
    expect(err.message).toMatch(/suspended/i);
  });
});
