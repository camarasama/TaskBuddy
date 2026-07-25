/**
 * U7 — "I'm saving for…" (growth roadmap §4.2).
 *
 * The goal-gradient effect: completion rates rise as a bar fills, so one visible target beats a
 * longer list of maybes.
 *
 * Two properties are doing the work:
 *
 *  - **Progress is DERIVED, never stored.** A stored counter would drift the moment points were
 *    spent, refunded, or reversed by the FR-03 revoke flow. Every read recomputes from the live
 *    balance.
 *  - **At most one pin per child.** Not expressible as a unique index (many `false` rows are legal),
 *    so it is enforced by clearing the others in the same transaction — and that is what these tests
 *    actually check.
 */

jest.mock('../src/services/database', () => {
  const tx = {
    rewardWishlist: { updateMany: jest.fn(), upsert: jest.fn() },
  };
  return {
    prisma: {
      reward: { findFirst: jest.fn() },
      rewardWishlist: { findFirst: jest.fn(), updateMany: jest.fn() },
      childProfile: { findUnique: jest.fn() },
      pointsLedger: { aggregate: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

import { GoalService, estimateTasksToGo, goalPercent } from '../src/services/GoalService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  reward: { findFirst: jest.Mock };
  rewardWishlist: { findFirst: jest.Mock; updateMany: jest.Mock };
  childProfile: { findUnique: jest.Mock };
  pointsLedger: { aggregate: jest.Mock };
  __tx: { rewardWishlist: { updateMany: jest.Mock; upsert: jest.Mock } };
};

const CHILD = 'child-1';
const FAMILY = 'fam-1';
const REWARD = 'reward-1';

beforeEach(() => {
  jest.clearAllMocks();
  p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 120 });
  p.pointsLedger.aggregate.mockResolvedValue({ _avg: { pointsAmount: 20 } });
});

describe('goalPercent', () => {
  it('reports partial progress', () => {
    expect(goalPercent(120, 200)).toBe(60);
  });

  it('CLAMPS at 100 — a child who can already afford it never sees 130%', () => {
    expect(goalPercent(260, 200)).toBe(100);
  });

  it('never goes negative', () => {
    expect(goalPercent(-50, 200)).toBe(0);
  });

  it('treats a free reward as complete rather than dividing by zero', () => {
    expect(goalPercent(0, 0)).toBe(100);
  });
});

describe('estimateTasksToGo', () => {
  it('uses the child’s OWN average award rate', () => {
    // A family awarding 50 a task should not be told "12 to go" when the honest answer is 4.
    expect(estimateTasksToGo(160, 50)).toBe(4);
  });

  it('rounds up — a part task is still a task', () => {
    expect(estimateTasksToGo(85, 20)).toBe(5);
  });

  it('is 0 once the reward is affordable', () => {
    expect(estimateTasksToGo(0, 20)).toBe(0);
    expect(estimateTasksToGo(-30, 20)).toBe(0);
  });

  it('falls back to a sane rate for a child with no earnings yet', () => {
    // Rate 0 would divide by zero and report Infinity tasks.
    expect(estimateTasksToGo(60, 0)).toBeGreaterThan(0);
    expect(Number.isFinite(estimateTasksToGo(60, 0))).toBe(true);
  });

  it('never reports 0 while points are still needed', () => {
    expect(estimateTasksToGo(1, 500)).toBe(1);
  });
});

describe('setGoal', () => {
  beforeEach(() => {
    p.reward.findFirst.mockResolvedValue({ id: REWARD, name: 'Cinema trip', pointsCost: 200 });
    p.rewardWishlist.findFirst.mockResolvedValue({
      rewardId: REWARD,
      reward: { id: REWARD, name: 'Cinema trip', pointsCost: 200, deletedAt: null, isActive: true },
    });
  });

  it('clears any existing pin before setting the new one', async () => {
    // "At most one true per child" cannot be a unique index, so this clear IS the constraint.
    await GoalService.setGoal({ childId: CHILD, familyId: FAMILY, rewardId: REWARD });
    expect(p.__tx.rewardWishlist.updateMany).toHaveBeenCalledWith({
      where: { childId: CHILD, isGoal: true },
      data: { isGoal: false },
    });
  });

  it('does both writes in ONE transaction, so a failure cannot leave two pins or none', async () => {
    await GoalService.setGoal({ childId: CHILD, familyId: FAMILY, rewardId: REWARD });
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalled();
  });

  it('adds the reward to the wishlist if it was not there', async () => {
    // Pinning something you have not hearted clearly means you want it; making the child do both
    // would be ceremony.
    await GoalService.setGoal({ childId: CHILD, familyId: FAMILY, rewardId: REWARD });
    const call = p.__tx.rewardWishlist.upsert.mock.calls[0][0];
    expect(call.create).toMatchObject({ rewardId: REWARD, childId: CHILD, isGoal: true });
    expect(call.update).toMatchObject({ isGoal: true });
  });

  it('404s for a reward outside the family', async () => {
    p.reward.findFirst.mockResolvedValue(null);
    await expect(
      GoalService.setGoal({ childId: CHILD, familyId: FAMILY, rewardId: 'other-family' }),
    ).rejects.toThrow(/not found/i);
  });

  it('scopes the reward lookup to the caller’s family', async () => {
    await GoalService.setGoal({ childId: CHILD, familyId: FAMILY, rewardId: REWARD });
    expect(p.reward.findFirst.mock.calls[0][0].where.familyId).toBe(FAMILY);
  });
});

describe('clearGoal', () => {
  it('un-pins without deleting the wishlist entry — un-pinning is not un-wanting', async () => {
    await GoalService.clearGoal(CHILD);
    expect(p.rewardWishlist.updateMany).toHaveBeenCalledWith({
      where: { childId: CHILD, isGoal: true },
      data: { isGoal: false },
    });
  });
});

describe('getGoal', () => {
  it('returns null when nothing is pinned', async () => {
    p.rewardWishlist.findFirst.mockResolvedValue(null);
    expect(await GoalService.getGoal(CHILD)).toBeNull();
  });

  it('derives progress from the LIVE balance, not a stored counter', async () => {
    p.rewardWishlist.findFirst.mockResolvedValue({
      rewardId: REWARD,
      reward: { name: 'Cinema trip', pointsCost: 200, deletedAt: null, isActive: true },
    });

    const goal = await GoalService.getGoal(CHILD);

    expect(goal).toMatchObject({
      name: 'Cinema trip',
      pointsCost: 200,
      pointsBalance: 120,
      pointsNeeded: 80,
      percent: 60,
      tasksToGo: 4, // 80 needed / 20 average
    });
  });

  it('reports 0 needed once the child can afford it', async () => {
    p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 500 });
    p.rewardWishlist.findFirst.mockResolvedValue({
      rewardId: REWARD,
      reward: { name: 'Cinema trip', pointsCost: 200, deletedAt: null, isActive: true },
    });

    const goal = await GoalService.getGoal(CHILD);
    expect(goal).toMatchObject({ pointsNeeded: 0, percent: 100, tasksToGo: 0 });
  });

  it('returns null when the pinned reward has been deleted', async () => {
    // A parent deleting the reward must not leave a child staring at a goal they can never reach.
    p.rewardWishlist.findFirst.mockResolvedValue({
      rewardId: REWARD,
      reward: { name: 'Gone', pointsCost: 200, deletedAt: new Date(), isActive: true },
    });
    expect(await GoalService.getGoal(CHILD)).toBeNull();
  });

  it('returns null when the pinned reward has been deactivated', async () => {
    p.rewardWishlist.findFirst.mockResolvedValue({
      rewardId: REWARD,
      reward: { name: 'Paused', pointsCost: 200, deletedAt: null, isActive: false },
    });
    expect(await GoalService.getGoal(CHILD)).toBeNull();
  });

  it('survives a child with no profile row', async () => {
    p.childProfile.findUnique.mockResolvedValue(null);
    p.rewardWishlist.findFirst.mockResolvedValue({
      rewardId: REWARD,
      reward: { name: 'Cinema trip', pointsCost: 200, deletedAt: null, isActive: true },
    });
    const goal = await GoalService.getGoal(CHILD);
    expect(goal).toMatchObject({ pointsBalance: 0, percent: 0 });
  });
});
