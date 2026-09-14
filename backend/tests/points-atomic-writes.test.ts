/**
 * Points move exactly once, whatever arrives at the same moment (security audit 2026-09-14, M1).
 *
 * Every earning and spending path used to read the balance, compute the new one in JavaScript and
 * write it back, with status checks done before the transaction. Parallel requests therefore:
 *   - redeemed one reward several times for one payment;
 *   - refunded one cancelled redemption several times;
 *   - paid a task twice (double tap on an auto-approve task, or two parents approving together).
 *
 * The database is mocked here, so these tests pin the SHAPE that makes the race impossible (a guarded
 * decrement, a claimed status transition) and that losing the race moves no points. The real
 * concurrency was checked once against Postgres; see the PR description.
 */
jest.mock('../src/services/database', () => {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    childProfile: { update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn() },
    rewardRedemption: { create: jest.fn() },
    pointsLedger: { create: jest.fn() },
    taskAssignment: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
  const prisma: any = {
    reward: { findFirst: jest.fn() },
    childProfile: { findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    taskAssignment: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
    taskEvidence: { create: jest.fn() },
    familySettings: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    __tx: tx,
  };
  return { prisma };
});
jest.mock('../src/utils/rewardCaps', () => ({
  checkRedemptionCaps: jest.fn().mockResolvedValue({ allowed: true }),
  getRewardCapData: jest.fn(),
}));
jest.mock('../src/services/achievements', () => ({ checkAndUnlockAchievements: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/services/levelService', () => ({
  checkAndApplyLevelUp: jest.fn().mockResolvedValue({ leveledUp: false, oldLevel: 1, newLevel: 1, bonusPointsAwarded: 0 }),
}));
jest.mock('../src/services/streakService', () => ({ evaluateStreak: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/TeamTaskService', () => ({
  awardTeamBonusIfComplete: jest.fn().mockResolvedValue({ awarded: false }),
}));
jest.mock('../src/services/AuditService', () => ({ AuditService: { logAction: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/services/AnalyticsService', () => ({
  AnalyticsService: { record: jest.fn(), recordFirstApproval: jest.fn() },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { sendToFamilyParents: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/routes/notifications', () => ({ createNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/SocketService', () => ({
  SocketService: new Proxy({}, { get: () => jest.fn() }),
}));

import { prisma } from '../src/services/database';
import { checkRedemptionCaps } from '../src/utils/rewardCaps';
import { creditPoints, debitPoints, forceDebitPoints, lockKey } from '../src/services/PointsWallet';
import { RewardService } from '../src/services/RewardService';
import { TaskService } from '../src/services/TaskService';

const db = prisma as any;
const tx = db.__tx;

beforeEach(() => {
  jest.clearAllMocks();
  tx.$executeRaw.mockResolvedValue(1);
  (checkRedemptionCaps as jest.Mock).mockResolvedValue({ allowed: true });
  tx.pointsLedger.create.mockResolvedValue({});
});

// ─── PointsWallet ────────────────────────────────────────────────────────────

describe('PointsWallet', () => {
  it('credits with an increment and returns the balance the row now holds', async () => {
    tx.childProfile.update.mockResolvedValue({ pointsBalance: 140 });

    const after = await creditPoints(tx, 'c1', 40, { totalPointsEarned: { increment: 40 } });

    expect(tx.childProfile.update).toHaveBeenCalledWith({
      where: { userId: 'c1' },
      data: { totalPointsEarned: { increment: 40 }, pointsBalance: { increment: 40 } },
      select: { pointsBalance: true },
    });
    expect(after).toBe(140);
  });

  it('debits only while the balance covers the amount, at the moment of the write', async () => {
    tx.childProfile.updateMany.mockResolvedValue({ count: 1 });
    tx.childProfile.findUnique.mockResolvedValue({ pointsBalance: 10 });

    const after = await debitPoints(tx, 'c1', 150);

    expect(tx.childProfile.updateMany).toHaveBeenCalledWith({
      where: { userId: 'c1', pointsBalance: { gte: 150 } },
      data: { pointsBalance: { decrement: 150 } },
    });
    expect(after).toBe(10);
  });

  it('refuses a debit the balance no longer covers, and reads nothing back', async () => {
    tx.childProfile.updateMany.mockResolvedValue({ count: 0 });

    await expect(debitPoints(tx, 'c1', 150, 'Too poor')).rejects.toThrow('Too poor');
    expect(tx.childProfile.findUnique).not.toHaveBeenCalled();
  });

  it('force-debits with a plain decrement (a parent correction may go negative)', async () => {
    tx.childProfile.update.mockResolvedValue({ pointsBalance: -40 });

    expect(await forceDebitPoints(tx, 'c1', 50)).toBe(-40);
    expect(tx.childProfile.update.mock.calls[0][0].data).toEqual({ pointsBalance: { decrement: 50 } });
  });

  it('locks a key for the rest of the transaction', async () => {
    await lockKey(tx, 'reward:r1');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const [strings, key] = tx.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(key).toBe('reward:r1');
  });
});

// ─── Redeeming a reward ──────────────────────────────────────────────────────

describe('RewardService.redeem', () => {
  const reward = { id: 'r1', familyId: 'f1', name: 'Movie night', pointsCost: 150, isActive: true, expiresAt: null, maxRedemptionsTotal: null, maxRedemptionsPerChild: 1 };

  beforeEach(() => {
    db.reward.findFirst.mockResolvedValue(reward);
    db.childProfile.findUnique.mockResolvedValue({ pointsBalance: 150 });
    db.user.findUnique.mockResolvedValue({ firstName: 'Maya', lastName: 'T' });
    tx.rewardRedemption.create.mockResolvedValue({ id: 'red1' });
  });

  it('charges through a guarded decrement under the reward lock, and records what the row holds', async () => {
    tx.childProfile.updateMany.mockResolvedValue({ count: 1 });
    tx.childProfile.findUnique.mockResolvedValue({ pointsBalance: 0 });

    const result = await RewardService.redeem({ rewardId: 'r1', familyId: 'f1', childId: 'c1' });

    expect(tx.$executeRaw.mock.calls[0][1]).toBe('reward:r1');
    expect(tx.childProfile.updateMany.mock.calls[0][0].where).toEqual({ userId: 'c1', pointsBalance: { gte: 150 } });
    expect(tx.pointsLedger.create.mock.calls[0][0].data).toMatchObject({ pointsAmount: -150, balanceAfter: 0 });
    expect(result.newBalance).toBe(0);
  });

  it('creates no redemption when a parallel redeem already spent the points', async () => {
    // Both requests passed the balance check above the transaction; this one lost the write.
    tx.childProfile.updateMany.mockResolvedValue({ count: 0 });

    await expect(RewardService.redeem({ rewardId: 'r1', familyId: 'f1', childId: 'c1' })).rejects.toThrow(/not enough points/i);
    expect(tx.rewardRedemption.create).not.toHaveBeenCalled();
    expect(tx.pointsLedger.create).not.toHaveBeenCalled();
  });

  it('re-checks the caps after taking the lock, so parallel redeems cannot exceed a one-per-child cap', async () => {
    (checkRedemptionCaps as jest.Mock)
      .mockResolvedValueOnce({ allowed: true }) // the early check, before the lock
      .mockResolvedValueOnce({ allowed: false, reason: 'You have already redeemed this reward.' });

    await expect(RewardService.redeem({ rewardId: 'r1', familyId: 'f1', childId: 'c1' })).rejects.toThrow(/already redeemed/i);
    expect(tx.childProfile.updateMany).not.toHaveBeenCalled();
    expect(tx.rewardRedemption.create).not.toHaveBeenCalled();
  });
});

// ─── Approving a task ────────────────────────────────────────────────────────

describe('TaskService.approveAssignment', () => {
  const completed = {
    id: 'a1',
    childId: 'c1',
    taskId: 't1',
    status: 'completed',
    task: { id: 't1', title: 'Make your bed', difficulty: 'easy', pointsValue: 10 },
    child: { id: 'c1', firstName: 'Maya', childProfile: { userId: 'c1', pointsBalance: 100, totalXpEarned: 0, level: 1 } },
  };

  beforeEach(() => {
    db.taskAssignment.findFirst.mockResolvedValue(completed);
    tx.taskAssignment.findUniqueOrThrow.mockResolvedValue({ id: 'a1', status: 'approved' });
    tx.childProfile.update.mockResolvedValue({ pointsBalance: 110 });
  });

  it('claims completed -> approved before paying, and pays by increment', async () => {
    tx.taskAssignment.updateMany.mockResolvedValue({ count: 1 });

    const result = await TaskService.approveAssignment({ assignmentId: 'a1', familyId: 'f1', parentId: 'p1', approved: true });

    expect(tx.taskAssignment.updateMany.mock.calls[0][0].where).toEqual({ id: 'a1', status: 'completed' });
    const data = tx.childProfile.update.mock.calls[0][0].data;
    expect(data.pointsBalance).toEqual({ increment: 10 });
    expect(data.totalXpEarned).toEqual({ increment: expect.any(Number) });
    expect(tx.pointsLedger.create.mock.calls[0][0].data.balanceAfter).toBe(110);
    expect(result.newBalance).toBe(110);
  });

  it('pays nothing on a double tap: the second approval finds the task already reviewed', async () => {
    tx.taskAssignment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      TaskService.approveAssignment({ assignmentId: 'a1', familyId: 'f1', parentId: 'p1', approved: true }),
    ).rejects.toThrow(/already been reviewed/i);
    expect(tx.childProfile.update).not.toHaveBeenCalled();
    expect(tx.pointsLedger.create).not.toHaveBeenCalled();
  });

  it('rejects through the same claim, so an approve and a reject cannot both land', async () => {
    db.taskAssignment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      TaskService.approveAssignment({ assignmentId: 'a1', familyId: 'f1', parentId: 'p1', approved: false, rejectionReason: 'Not done' }),
    ).rejects.toThrow(/already been reviewed/i);
    expect(db.taskAssignment.updateMany.mock.calls[0][0].where).toEqual({ id: 'a1', status: 'completed' });
  });
});

// ─── Completing a task ───────────────────────────────────────────────────────

describe('TaskService.submitCompletion', () => {
  const autoApprove = {
    id: 'a1',
    childId: 'c1',
    taskId: 't1',
    status: 'pending',
    task: { id: 't1', title: 'Feed the cat', autoApprove: true, estimatedMinutes: null, difficulty: 'easy', pointsValue: 15 },
    child: { id: 'c1', firstName: 'Maya', lastName: 'T' },
  };

  beforeEach(() => {
    db.taskAssignment.findFirst.mockResolvedValue(autoApprove);
    db.taskAssignment.findUniqueOrThrow.mockResolvedValue({ id: 'a1', status: 'completed' });
    db.user.findUnique.mockResolvedValue({ id: 'c1', childProfile: { pointsBalance: 100, totalXpEarned: 0, level: 1 } });
  });

  it('refuses a second completion that raced the first, before anything is paid', async () => {
    db.taskAssignment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      TaskService.submitCompletion({ assignmentId: 'a1', familyId: 'f1', userId: 'c1', userRole: 'child' }),
    ).rejects.toThrow(/already completed/i);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('pays nothing on auto-approve when a parent approved the submission first', async () => {
    db.taskAssignment.updateMany.mockResolvedValue({ count: 1 });
    tx.taskAssignment.updateMany.mockResolvedValue({ count: 0 });

    const result = await TaskService.submitCompletion({ assignmentId: 'a1', familyId: 'f1', userId: 'c1', userRole: 'child' });

    expect(tx.childProfile.update).not.toHaveBeenCalled();
    expect(tx.pointsLedger.create).not.toHaveBeenCalled();
    expect(result).toEqual({ assignment: { id: 'a1', status: 'completed' } });
  });

  it('auto-approves once, paying by increment', async () => {
    db.taskAssignment.updateMany.mockResolvedValue({ count: 1 });
    tx.taskAssignment.updateMany.mockResolvedValue({ count: 1 });
    tx.taskAssignment.findUniqueOrThrow.mockResolvedValue({ id: 'a1', status: 'approved' });
    tx.childProfile.update.mockResolvedValue({ pointsBalance: 115 });

    const result: any = await TaskService.submitCompletion({ assignmentId: 'a1', familyId: 'f1', userId: 'c1', userRole: 'child' });

    expect(tx.taskAssignment.updateMany.mock.calls[0][0].where).toEqual({ id: 'a1', status: 'completed' });
    expect(tx.childProfile.update.mock.calls[0][0].data.pointsBalance).toEqual({ increment: 15 });
    expect(result).toMatchObject({ autoApproved: true, newBalance: 115 });
  });
});
