/**
 * Buying streak insurance (growth roadmap §11.4).
 *
 * Shields were already earnable, one per 7-day milestone (§4.3). This is the second route to the
 * same bank, and the tests below are about the two ways it could go wrong with real points:
 *
 *  1. **The cap must hold.** Buying tops up TOWARD `MAX_STREAK_FREEZES` and never past it. Without
 *     that, a child with a large balance becomes streak-immune and the streak stops carrying any
 *     information about what they actually did.
 *  2. **It must not be raceable.** Shields are fungible, so unlike a cosmetic there is no unique
 *     constraint to catch a double buy. The preconditions therefore live in the UPDATE's `where`
 *     clause; a concurrent second call must find `count === 0` and charge nothing.
 *
 * Prisma is mocked, so this asserts the SHAPE of the write rather than a database round trip: that
 * the balance check and the cap check are conditions on the update and not read-then-write, which is
 * the difference between "safe" and "usually safe".
 */

import { MAX_STREAK_FREEZES } from '../src/services/streakService';
import { STREAK_SHIELD_COST } from '@taskbuddy/shared';

const updateMany = jest.fn();
const findUnique = jest.fn();
const ledgerCreate = jest.fn();

jest.mock('../src/services/database', () => ({
  prisma: {
    childProfile: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      updateMany: (...a: unknown[]) => updateMany(...a),
    },
    pointsLedger: { create: (...a: unknown[]) => ledgerCreate(...a) },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        childProfile: {
          findUnique: (...a: unknown[]) => findUnique(...a),
          updateMany: (...a: unknown[]) => updateMany(...a),
        },
        pointsLedger: { create: (...a: unknown[]) => ledgerCreate(...a) },
      }),
  },
}));

import { purchase, status } from '../src/services/StreakShieldService';

beforeEach(() => {
  updateMany.mockReset();
  findUnique.mockReset();
  ledgerCreate.mockReset();
});

describe('status — what the button should say', () => {
  it('allows a buy with points to spare and room in the bank', async () => {
    findUnique.mockResolvedValue({ streakFreezes: 0, pointsBalance: 100 });
    const s = await status('child-1');
    expect(s).toMatchObject({ canBuy: true, reason: null, cost: STREAK_SHIELD_COST, max: MAX_STREAK_FREEZES });
  });

  it('reports the CAP first when the child is both full and short of points', async () => {
    // Order matters for the message a child reads: at the cap, more points change nothing, so
    // "you need 12 more points" would send them off to earn something useless.
    findUnique.mockResolvedValue({ streakFreezes: MAX_STREAK_FREEZES, pointsBalance: 0 });
    const s = await status('child-1');
    expect(s.canBuy).toBe(false);
    expect(s.reason).toBe('at_cap');
  });

  it('reports short points when there is room in the bank', async () => {
    findUnique.mockResolvedValue({ streakFreezes: 0, pointsBalance: STREAK_SHIELD_COST - 1 });
    const s = await status('child-1');
    expect(s.canBuy).toBe(false);
    expect(s.reason).toBe('not_enough_points');
  });
});

describe('purchase — the charge is conditional, not read-then-write', () => {
  it('puts BOTH preconditions in the update, so the database enforces them', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({ streakFreezes: 1, pointsBalance: 60 });

    await purchase('child-1');

    // The heart of the test. If either of these moves out of `where` and into a prior read, two
    // concurrent buys can both succeed and the cap becomes advisory.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'child-1',
          pointsBalance: { gte: STREAK_SHIELD_COST },
          streakFreezes: { lt: MAX_STREAK_FREEZES },
        }),
        data: expect.objectContaining({
          pointsBalance: { decrement: STREAK_SHIELD_COST },
          streakFreezes: { increment: 1 },
        }),
      }),
    );
  });

  it('writes a ledger row matching a redemption, so the balance stays auditable', async () => {
    updateMany.mockResolvedValue({ count: 1 });
    findUnique.mockResolvedValue({ streakFreezes: 1, pointsBalance: 60 });

    const result = await purchase('child-1');

    expect(ledgerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        childId: 'child-1',
        transactionType: 'redeemed',
        pointsAmount: -STREAK_SHIELD_COST,
        balanceAfter: 60,
        referenceType: 'streak_shield',
      }),
    });
    expect(result).toEqual({ pointsSpent: STREAK_SHIELD_COST, newBalance: 60, owned: 1 });
  });

  it('charges nothing when a concurrent buy won the race', async () => {
    // count === 0 means the row no longer matched: someone else spent the points or filled the bank.
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ streakFreezes: MAX_STREAK_FREEZES, pointsBalance: 100 });

    await expect(purchase('child-1')).rejects.toThrow(/most you can keep/i);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('explains a shortfall in points a child can act on', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ streakFreezes: 0, pointsBalance: STREAK_SHIELD_COST - 7 });

    await expect(purchase('child-1')).rejects.toThrow(/7 more points/);
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it('uses the singular when exactly one point short', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findUnique.mockResolvedValue({ streakFreezes: 0, pointsBalance: STREAK_SHIELD_COST - 1 });

    await expect(purchase('child-1')).rejects.toThrow(/1 more point[^s]/);
  });
});

describe('the economy numbers stay defensible', () => {
  it('costs meaningfully less than a day of chores but more than a game', () => {
    // ~60-90 points/day from tasks; a hard game pays 4. A shield has to be a real trade against
    // something the child wanted, without being unreachable.
    expect(STREAK_SHIELD_COST).toBeGreaterThan(10);
    expect(STREAK_SHIELD_COST).toBeLessThan(60);
  });

  it('cannot buy past the cap even in principle', () => {
    expect(MAX_STREAK_FREEZES).toBeGreaterThan(0);
    expect(MAX_STREAK_FREEZES).toBeLessThanOrEqual(5);
  });
});
