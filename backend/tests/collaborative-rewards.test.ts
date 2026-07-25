/**
 * FR-09 — collaborative rewards. Reward.isCollaborative existed but nothing read it. These pin the
 * contribution accounting and, above all, that auto-fulfilment fires EXACTLY once no matter how the
 * contributions land.
 */
jest.mock('../src/services/database', () => {
  const tx = {
    rewardContribution: { create: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
    childProfile: { update: jest.fn() },
    pointsLedger: { create: jest.fn() },
    reward: { updateMany: jest.fn() },
    // Funding now also records WHO paid: one redemption row per contributor, so a funded shared
    // reward has a recipient and reaches R-03. Covered in collaborative-recipient.test.ts; mocked
    // here so this file keeps testing the contribution accounting it was written for.
    rewardRedemption: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  return {
    prisma: {
      reward: { findFirst: jest.fn() },
      childProfile: { findUnique: jest.fn() },
      rewardContribution: { aggregate: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});
jest.mock('../src/services/achievements', () => ({ checkAndUnlockAchievements: jest.fn() }));
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn(), sendToFamilyParents: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/SocketService', () => ({ SocketService: {} }));
jest.mock('../src/routes/notifications', () => ({ createNotification: jest.fn() }));

import { RewardService } from '../src/services/RewardService';
import { prisma } from '../src/services/database';

const db = prisma as unknown as {
  reward: { findFirst: jest.Mock };
  childProfile: { findUnique: jest.Mock };
  rewardContribution: { aggregate: jest.Mock };
  __tx: {
    rewardContribution: { create: jest.Mock };
    childProfile: { update: jest.Mock };
    pointsLedger: { create: jest.Mock };
    reward: { updateMany: jest.Mock };
  };
};

const reward = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  familyId: 'f1',
  name: 'Family movie night',
  pointsCost: 100,
  isCollaborative: true,
  isActive: true,
  collaborativeFulfilledAt: null,
  deletedAt: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.__tx.rewardContribution.create.mockResolvedValue({});
  db.__tx.childProfile.update.mockResolvedValue({});
  db.__tx.pointsLedger.create.mockResolvedValue({});
  db.__tx.reward.updateMany.mockResolvedValue({ count: 1 });
});

describe('RewardService.contribute — accounting', () => {
  it('debits the child via a NEGATIVE ledger row and records the contribution', async () => {
    db.reward.findFirst.mockResolvedValue(reward());
    db.childProfile.findUnique.mockResolvedValue({ pointsBalance: 80 });
    db.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 20 } }); // 20 pooled

    const result = await RewardService.contribute({
      rewardId: 'r1',
      familyId: 'f1',
      childId: 'c1',
      points: 30,
    });

    expect(result).toMatchObject({ applied: 30, newBalance: 50, pooled: 50, fulfilled: false });
    const ledger = db.__tx.pointsLedger.create.mock.calls[0][0].data;
    expect(ledger.pointsAmount).toBe(-30);
    expect(ledger.referenceType).toBe('reward_contribution');
    expect(db.__tx.rewardContribution.create).toHaveBeenCalled();
  });

  it('caps the contribution at what is still needed, so the pool cannot overshoot', async () => {
    db.reward.findFirst.mockResolvedValue(reward());
    db.childProfile.findUnique.mockResolvedValue({ pointsBalance: 500 });
    db.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 90 } }); // 10 to go

    const result = await RewardService.contribute({
      rewardId: 'r1',
      familyId: 'f1',
      childId: 'c1',
      points: 40, // wants to give 40, only 10 needed
    });

    expect(result.applied).toBe(10); // capped
    expect(db.__tx.pointsLedger.create.mock.calls[0][0].data.pointsAmount).toBe(-10);
  });

  it('rejects a contribution larger than the child can afford', async () => {
    db.reward.findFirst.mockResolvedValue(reward());
    db.childProfile.findUnique.mockResolvedValue({ pointsBalance: 5 });
    db.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 0 } });

    await expect(
      RewardService.contribute({ rewardId: 'r1', familyId: 'f1', childId: 'c1', points: 30 }),
    ).rejects.toThrow(/not enough points/i);
    expect(db.__tx.rewardContribution.create).not.toHaveBeenCalled();
  });

  it('refuses a non-collaborative reward', async () => {
    db.reward.findFirst.mockResolvedValue(reward({ isCollaborative: false }));
    await expect(
      RewardService.contribute({ rewardId: 'r1', familyId: 'f1', childId: 'c1', points: 10 }),
    ).rejects.toThrow(/not collaborative/i);
  });

  it('refuses one scoped to another family', async () => {
    db.reward.findFirst.mockResolvedValue(null); // family-scoped query finds nothing
    await expect(
      RewardService.contribute({ rewardId: 'r1', familyId: 'other', childId: 'c1', points: 10 }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('RewardService.contribute — auto-fulfilment, exactly once', () => {
  it('fulfils when the pool first reaches the goal, via a conditional claim on null', async () => {
    db.reward.findFirst.mockResolvedValue(reward());
    db.childProfile.findUnique.mockResolvedValue({ pointsBalance: 100 });
    db.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 70 } }); // 30 to go
    db.__tx.reward.updateMany.mockResolvedValue({ count: 1 }); // we won the claim

    const result = await RewardService.contribute({
      rewardId: 'r1',
      familyId: 'f1',
      childId: 'c1',
      points: 30,
    });

    expect(result.fulfilled).toBe(true);
    const claim = db.__tx.reward.updateMany.mock.calls[0][0];
    expect(claim.where.collaborativeFulfilledAt).toBeNull(); // only flips null → now
  });

  it('does NOT double-fulfil: a racing contribution that loses the claim reports fulfilled=false', async () => {
    db.reward.findFirst.mockResolvedValue(reward());
    db.childProfile.findUnique.mockResolvedValue({ pointsBalance: 100 });
    db.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 95 } });
    db.__tx.reward.updateMany.mockResolvedValue({ count: 0 }); // another tx already claimed it

    const result = await RewardService.contribute({
      rewardId: 'r1',
      familyId: 'f1',
      childId: 'c1',
      points: 10,
    });

    expect(result.fulfilled).toBe(false); // points still counted, but fulfilment not re-fired
  });

  it('rejects a contribution to an already-funded reward before touching the balance', async () => {
    db.reward.findFirst.mockResolvedValue(reward({ collaborativeFulfilledAt: new Date() }));
    db.childProfile.findUnique.mockResolvedValue({ pointsBalance: 100 });

    await expect(
      RewardService.contribute({ rewardId: 'r1', familyId: 'f1', childId: 'c1', points: 10 }),
    ).rejects.toThrow(/already been fully funded/i);
    expect(db.__tx.rewardContribution.create).not.toHaveBeenCalled();
  });
});
