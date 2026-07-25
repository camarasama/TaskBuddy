/**
 * Collaborative reward recipients + reporting (follow-up to FR-09).
 *
 * FR-09 shipped contributions and once-only funding, but funding never created a
 * `rewardRedemption` row. So a funded shared reward had **no recorded recipient**, no
 * fulfilled/cancelled workflow, and appeared in **no** redemption report — while R-02 showed the
 * points correctly. The two reports disagreed about the same event.
 *
 * The rule chosen, and what these tests defend:
 *  - one redemption row PER CONTRIBUTOR, carrying that child's OWN contribution, so R-03 reconciles
 *    against the ledger instead of crediting one child with the whole cost;
 *  - **not** last-contributor-wins, which rewards timing over effort and teaches children to
 *    withhold points and snipe the final few;
 *  - `shared` by default; `parent_choice` requires the parent to designate an actual contributor.
 */

jest.mock('../src/services/database', () => {
  const tx = {
    rewardContribution: { create: jest.fn(), groupBy: jest.fn() },
    childProfile: { update: jest.fn() },
    pointsLedger: { create: jest.fn() },
    reward: { updateMany: jest.fn() },
    rewardRedemption: { createMany: jest.fn() },
  };
  return {
    prisma: {
      reward: { findFirst: jest.fn() },
      childProfile: { findUnique: jest.fn() },
      rewardContribution: { aggregate: jest.fn() },
      rewardRedemption: { findMany: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

jest.mock('../src/services/AuditService', () => ({ AuditService: { logAction: jest.fn() } }));
jest.mock('../src/services/email', () => ({
  EmailService: { sendToFamilyParents: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/routes/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../src/services/achievements', () => ({
  checkAndUnlockAchievements: jest.fn().mockResolvedValue([]),
}));
jest.mock('../src/services/SocketService', () => ({
  SocketService: { emitPointsUpdated: jest.fn(), emitRewardRedeemed: jest.fn() },
}));

import { RewardService } from '../src/services/RewardService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  reward: { findFirst: jest.Mock };
  childProfile: { findUnique: jest.Mock };
  rewardContribution: { aggregate: jest.Mock };
  rewardRedemption: { findMany: jest.Mock; updateMany: jest.Mock };
  __tx: {
    rewardContribution: { create: jest.Mock; groupBy: jest.Mock };
    reward: { updateMany: jest.Mock };
    rewardRedemption: { createMany: jest.Mock };
    childProfile: { update: jest.Mock };
    pointsLedger: { create: jest.Mock };
  };
};

const FAMILY = 'fam-1';
const REWARD = 'reward-1';

const sharedReward = {
  id: REWARD,
  name: 'Family film night',
  pointsCost: 500,
  isCollaborative: true,
  isActive: true,
  deletedAt: null,
  collaborativeFulfilledAt: null as Date | null,
  recipientRule: 'shared',
};

beforeEach(() => {
  jest.clearAllMocks();
  p.reward.findFirst.mockResolvedValue({ ...sharedReward });
  p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 1000 });
  p.__tx.reward.updateMany.mockResolvedValue({ count: 1 });
  p.__tx.rewardRedemption.createMany.mockResolvedValue({ count: 3 });
  p.__tx.rewardContribution.groupBy.mockResolvedValue([
    { childId: 'ama', _sum: { points: 250 } },
    { childId: 'kofi', _sum: { points: 150 } },
    { childId: 'esi', _sum: { points: 100 } },
  ]);
});

// ─── Funding now records who paid ─────────────────────────────────────────────

describe('contribute — the completing contribution', () => {
  it('creates ONE redemption row per contributor', async () => {
    p.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 400 } });

    await RewardService.contribute({ rewardId: REWARD, familyId: FAMILY, childId: 'esi', points: 100 });

    const rows = p.__tx.rewardRedemption.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(3);
    expect(rows.map((r: { childId: string }) => r.childId).sort()).toEqual(['ama', 'esi', 'kofi']);
  });

  it('records each child’s OWN contribution, not the full cost', async () => {
    // "Ama redeemed a 500-point reward" when she gave 250 would be false, and would stop R-03
    // reconciling against the ledger rows the contributions already wrote.
    p.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 400 } });

    await RewardService.contribute({ rewardId: REWARD, familyId: FAMILY, childId: 'esi', points: 100 });

    const rows = p.__tx.rewardRedemption.createMany.mock.calls[0][0].data;
    expect(rows.find((r: { childId: string }) => r.childId === 'ama').pointsSpent).toBe(250);
    expect(rows.find((r: { childId: string }) => r.childId === 'esi').pointsSpent).toBe(100);
  });

  it('does NOT deduct points again — each contribution already charged the child', async () => {
    p.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 400 } });

    await RewardService.contribute({ rewardId: REWARD, familyId: FAMILY, childId: 'esi', points: 100 });

    // One profile update and one ledger row: the contribution itself. Fulfilment adds neither.
    expect(p.__tx.childProfile.update).toHaveBeenCalledTimes(1);
    expect(p.__tx.pointsLedger.create).toHaveBeenCalledTimes(1);
  });

  it('leaves recipientChildId null — a parent designates later, the code does not guess', async () => {
    p.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 400 } });

    await RewardService.contribute({ rewardId: REWARD, familyId: FAMILY, childId: 'esi', points: 100 });

    const rows = p.__tx.rewardRedemption.createMany.mock.calls[0][0].data;
    for (const row of rows) expect(row.recipientChildId).toBeNull();
  });

  it('creates NOTHING when the contribution does not complete the goal', async () => {
    p.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 100 } });

    await RewardService.contribute({ rewardId: REWARD, familyId: FAMILY, childId: 'kofi', points: 150 });

    expect(p.__tx.rewardRedemption.createMany).not.toHaveBeenCalled();
  });

  it('creates nothing when it LOSES the atomic fulfilment claim', async () => {
    // Two racing contributions can both reach the goal; only the one that flips the timestamp writes
    // the redemptions, or contributors would be recorded twice.
    p.rewardContribution.aggregate.mockResolvedValue({ _sum: { points: 400 } });
    p.__tx.reward.updateMany.mockResolvedValue({ count: 0 });

    await RewardService.contribute({ rewardId: REWARD, familyId: FAMILY, childId: 'esi', points: 100 });

    expect(p.__tx.rewardRedemption.createMany).not.toHaveBeenCalled();
  });
});

// ─── Parent fulfilment ────────────────────────────────────────────────────────

describe('fulfilCollaborative', () => {
  beforeEach(() => {
    p.reward.findFirst.mockResolvedValue({
      ...sharedReward,
      collaborativeFulfilledAt: new Date(),
    });
    p.rewardRedemption.findMany.mockResolvedValue([
      { id: 'r1', childId: 'ama' },
      { id: 'r2', childId: 'kofi' },
      { id: 'r3', childId: 'esi' },
    ]);
    p.rewardRedemption.updateMany.mockResolvedValue({ count: 3 });
  });

  it('marks every contributor’s row delivered in one write', async () => {
    const result = await RewardService.fulfilCollaborative({
      rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1',
    });

    expect(p.rewardRedemption.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'fulfilled',
      approvedBy: 'parent-1',
    });
    expect(result.contributors).toBe(3);
  });

  it('leaves the recipient null for a SHARED reward', async () => {
    // A film night is not one child's.
    const result = await RewardService.fulfilCollaborative({
      rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1',
    });
    expect(result.recipientChildId).toBeNull();
  });

  it('ignores a recipient passed for a shared reward rather than silently honouring it', async () => {
    const result = await RewardService.fulfilCollaborative({
      rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1', recipientChildId: 'ama',
    });
    expect(result.recipientChildId).toBeNull();
  });

  it('REQUIRES a recipient when the rule is parent_choice', async () => {
    p.reward.findFirst.mockResolvedValue({
      ...sharedReward, collaborativeFulfilledAt: new Date(), recipientRule: 'parent_choice',
    });
    await expect(
      RewardService.fulfilCollaborative({ rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1' }),
    ).rejects.toThrow(/choose which child/i);
  });

  it('refuses a recipient who did not contribute', async () => {
    // Crediting a child who gave nothing would make the report a lie.
    p.reward.findFirst.mockResolvedValue({
      ...sharedReward, collaborativeFulfilledAt: new Date(), recipientRule: 'parent_choice',
    });
    await expect(
      RewardService.fulfilCollaborative({
        rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1', recipientChildId: 'freeloader',
      }),
    ).rejects.toThrow(/must be one of the children who contributed/i);
  });

  it('records the designated recipient on every row, so the report can show it', async () => {
    p.reward.findFirst.mockResolvedValue({
      ...sharedReward, collaborativeFulfilledAt: new Date(), recipientRule: 'parent_choice',
    });

    const result = await RewardService.fulfilCollaborative({
      rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1', recipientChildId: 'kofi',
    });

    expect(result.recipientChildId).toBe('kofi');
    expect(p.rewardRedemption.updateMany.mock.calls[0][0].data.recipientChildId).toBe('kofi');
  });

  it('refuses a reward that is not fully funded yet', async () => {
    p.reward.findFirst.mockResolvedValue({ ...sharedReward, collaborativeFulfilledAt: null });
    await expect(
      RewardService.fulfilCollaborative({ rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1' }),
    ).rejects.toThrow(/not fully funded/i);
  });

  it('refuses a second delivery', async () => {
    p.rewardRedemption.findMany.mockResolvedValue([]);
    await expect(
      RewardService.fulfilCollaborative({ rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1' }),
    ).rejects.toThrow(/already been marked as delivered/i);
  });

  it('refuses a non-collaborative reward', async () => {
    p.reward.findFirst.mockResolvedValue({ ...sharedReward, isCollaborative: false });
    await expect(
      RewardService.fulfilCollaborative({ rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1' }),
    ).rejects.toThrow(/not collaborative/i);
  });

  it('404s for a reward outside the family', async () => {
    p.reward.findFirst.mockResolvedValue(null);
    await expect(
      RewardService.fulfilCollaborative({ rewardId: REWARD, familyId: FAMILY, parentId: 'parent-1' }),
    ).rejects.toThrow(/not found/i);
  });
});
