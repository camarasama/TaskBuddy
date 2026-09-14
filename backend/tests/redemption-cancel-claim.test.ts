import request from 'supertest';

/**
 * Cancelling a redemption refunds exactly once (security audit 2026-09-14, M1).
 *
 * The pending lookup runs outside the transaction, so parallel cancels of one redemption all found
 * it pending and each refunded the full cost. The cancellation is now claimed with a conditional
 * write on `status: 'pending'`; only the request that flips it refunds.
 */
jest.mock('../src/services/database', () => {
  const tx: any = {
    rewardRedemption: { updateMany: jest.fn() },
    childProfile: { update: jest.fn() },
    pointsLedger: { create: jest.fn() },
  };
  return {
    prisma: {
      rewardRedemption: { findFirst: jest.fn() },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      $queryRaw: jest.fn(),
      __tx: tx,
    },
  };
});

let CURRENT: { userId: string; role: string; familyId: string };
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => { req.user = { ...CURRENT }; next(); },
    familyIsolation: (req: any, _res: any, next: any) => { req.familyId = CURRENT.familyId; next(); },
  };
});
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));

import { app } from '../src/index';
import { prisma } from '../src/services/database';

const db = prisma as any;
const tx = db.__tx;

const pending = {
  id: 'red1',
  childId: 'kid1',
  rewardId: 'r1',
  pointsSpent: 150,
  status: 'pending',
  reward: { id: 'r1', name: 'Movie night', familyId: 'fam1' },
};

beforeEach(() => {
  jest.clearAllMocks();
  CURRENT = { userId: 'kid1', role: 'child', familyId: 'fam1' };
  db.rewardRedemption.findFirst.mockResolvedValue(pending);
  tx.childProfile.update.mockResolvedValue({ pointsBalance: 150 });
  tx.pointsLedger.create.mockResolvedValue({});
});

describe('PUT /rewards/redemptions/:id/cancel', () => {
  it('claims the cancellation, then refunds by increment and records the resulting balance', async () => {
    tx.rewardRedemption.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).put('/api/v1/rewards/redemptions/red1/cancel');

    expect(res.status).toBe(200);
    expect(tx.rewardRedemption.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'red1', status: 'pending' },
      data: { status: 'cancelled' },
    });
    expect(tx.childProfile.update.mock.calls[0][0].data).toEqual({ pointsBalance: { increment: 150 } });
    expect(tx.pointsLedger.create.mock.calls[0][0].data).toMatchObject({ pointsAmount: 150, balanceAfter: 150 });
  });

  it('refunds nothing when a parallel cancel got there first', async () => {
    tx.rewardRedemption.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(app).put('/api/v1/rewards/redemptions/red1/cancel');

    expect(res.status).toBe(409);
    expect(tx.childProfile.update).not.toHaveBeenCalled();
    expect(tx.pointsLedger.create).not.toHaveBeenCalled();
  });

  it('still refuses a child cancelling a sibling\'s redemption', async () => {
    db.rewardRedemption.findFirst.mockResolvedValue({ ...pending, childId: 'sibling' });

    const res = await request(app).put('/api/v1/rewards/redemptions/red1/cancel');

    expect(res.status).toBe(403);
    expect(tx.rewardRedemption.updateMany).not.toHaveBeenCalled();
  });
});
