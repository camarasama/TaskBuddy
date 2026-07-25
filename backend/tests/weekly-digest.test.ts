/**
 * U3 — the weekly parent digest (growth roadmap §3.3, #2 priority).
 *
 * The rule doing the most work is "a silent week sends nothing". A digest that arrives saying
 * "0 tasks, 0 points, nothing happened" trains parents to ignore the sender, and unsubscribes are
 * unrecoverable — so `buildFamilyDigest` returns null rather than producing an empty email. A
 * pending approval alone still counts as worth sending, because that is a blocked child.
 *
 * The open-tracking pixel is public by necessity (email clients cannot authenticate), so its
 * signature tests matter: without them anyone could enumerate family ids and fabricate
 * DIGEST_OPENED events, poisoning the exact metric it exists to produce.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    taskAssignment: { groupBy: jest.fn(), count: jest.fn() },
    pointsLedger: { findMany: jest.fn() },
    childAchievement: { groupBy: jest.fn() },
    reward: { findMany: jest.fn() },
  },
}));

import { DigestService, chooseSuggestedAction, lastWeekWindow } from '../src/services/DigestService';
import { signDigestOpen, weekKey } from '../src/routes/track';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  user: { findMany: jest.Mock };
  taskAssignment: { groupBy: jest.Mock; count: jest.Mock };
  pointsLedger: { findMany: jest.Mock };
  childAchievement: { groupBy: jest.Mock };
  reward: { findMany: jest.Mock };
};

const FAMILY = 'fam-1';
/** A Wednesday, so the window maths has to walk backwards rather than trivially align. */
const WEDNESDAY = new Date('2026-07-22T09:00:00Z');

function withActivity() {
  p.user.findMany.mockResolvedValue([
    { id: 'c1', firstName: 'Emma', childProfile: { currentStreakDays: 4 } },
  ]);
  p.taskAssignment.groupBy.mockResolvedValue([{ childId: 'c1', _count: { _all: 5 } }]);
  p.pointsLedger.findMany.mockResolvedValue([
    { childId: 'c1', pointsAmount: 50 },
    { childId: 'c1', pointsAmount: -20 },
  ]);
  p.childAchievement.groupBy.mockResolvedValue([{ childId: 'c1', _count: { _all: 1 } }]);
  p.taskAssignment.count.mockResolvedValue(0);
  p.reward.findMany.mockResolvedValue([]);
}

beforeEach(() => jest.clearAllMocks());

describe('lastWeekWindow', () => {
  it('spans the seven days ending on the most recent Monday', () => {
    const { weekStart, weekEnd } = lastWeekWindow(WEDNESDAY);
    expect(weekEnd.toISOString().slice(0, 10)).toBe('2026-07-20'); // Monday
    expect(weekStart.toISOString().slice(0, 10)).toBe('2026-07-13'); // Monday before
  });

  it('treats Sunday as belonging to the week that has not closed yet', () => {
    // getUTCDay() is 0 on Sunday; the naive (day - 1) form goes backwards a week here.
    const { weekEnd } = lastWeekWindow(new Date('2026-07-26T09:00:00Z'));
    expect(weekEnd.toISOString().slice(0, 10)).toBe('2026-07-20');
  });

  it('is exactly 7 days wide', () => {
    const { weekStart, weekEnd } = lastWeekWindow(WEDNESDAY);
    expect(weekEnd.getTime() - weekStart.getTime()).toBe(7 * 86_400_000);
  });
});

describe('buildFamilyDigest', () => {
  it('splits points into earned and spent rather than a net figure', async () => {
    // A child who earned 50 and spent 20 must not be reported as "30 points".
    withActivity();
    const digest = await DigestService.buildFamilyDigest(FAMILY, WEDNESDAY);
    expect(digest!.children[0]).toMatchObject({ pointsEarned: 50, pointsSpent: 20 });
  });

  it('carries per-child approvals, streak and unlocks', async () => {
    withActivity();
    const digest = await DigestService.buildFamilyDigest(FAMILY, WEDNESDAY);
    expect(digest!.children[0]).toMatchObject({
      firstName: 'Emma',
      tasksApproved: 5,
      currentStreak: 4,
      achievementsUnlocked: 1,
    });
  });

  it('totals across the family', async () => {
    withActivity();
    const digest = await DigestService.buildFamilyDigest(FAMILY, WEDNESDAY);
    expect(digest!.totals).toEqual({ tasksApproved: 5, pointsEarned: 50 });
  });

  // The rule that matters most.
  it('returns null for a silent week — no approvals, no points, nothing waiting', async () => {
    p.user.findMany.mockResolvedValue([
      { id: 'c1', firstName: 'Emma', childProfile: { currentStreakDays: 0 } },
    ]);
    p.taskAssignment.groupBy.mockResolvedValue([]);
    p.pointsLedger.findMany.mockResolvedValue([]);
    p.childAchievement.groupBy.mockResolvedValue([]);
    p.taskAssignment.count.mockResolvedValue(0);
    p.reward.findMany.mockResolvedValue([]);

    expect(await DigestService.buildFamilyDigest(FAMILY, WEDNESDAY)).toBeNull();
  });

  it('DOES send when the only thing to report is a pending approval', async () => {
    // A blocked child is worth an email even in an otherwise quiet week.
    p.user.findMany.mockResolvedValue([
      { id: 'c1', firstName: 'Emma', childProfile: { currentStreakDays: 0 } },
    ]);
    p.taskAssignment.groupBy.mockResolvedValue([]);
    p.pointsLedger.findMany.mockResolvedValue([]);
    p.childAchievement.groupBy.mockResolvedValue([]);
    p.taskAssignment.count.mockResolvedValue(2);
    p.reward.findMany.mockResolvedValue([]);

    const digest = await DigestService.buildFamilyDigest(FAMILY, WEDNESDAY);
    expect(digest).not.toBeNull();
    expect(digest!.pendingApprovals).toBe(2);
  });

  it('returns null for a family with no children', async () => {
    p.user.findMany.mockResolvedValue([]);
    expect(await DigestService.buildFamilyDigest(FAMILY, WEDNESDAY)).toBeNull();
  });

  it('scopes every query to the week window', async () => {
    withActivity();
    await DigestService.buildFamilyDigest(FAMILY, WEDNESDAY);
    const where = p.taskAssignment.groupBy.mock.calls[0][0].where;
    expect(where.approvedAt.gte.toISOString().slice(0, 10)).toBe('2026-07-13');
    expect(where.approvedAt.lt.toISOString().slice(0, 10)).toBe('2026-07-20');
  });
});

describe('chooseSuggestedAction', () => {
  const base = {
    familyId: FAMILY,
    weekStart: new Date(),
    weekEnd: new Date(),
    children: [] as never[],
    pendingApprovals: 0,
    expiringRewards: [] as Array<{ name: string; expiresAt: Date }>,
    totals: { tasksApproved: 0, pointsEarned: 0 },
  };

  it('puts a pending approval first — that is a blocked child', () => {
    const action = chooseSuggestedAction({ ...base, pendingApprovals: 3 });
    expect(action).toContain('3 tasks');
    expect(action).toMatch(/waiting for your approval/);
  });

  it('uses singular grammar for one pending task', () => {
    expect(chooseSuggestedAction({ ...base, pendingApprovals: 1 })).toContain('1 task is waiting');
  });

  it('falls to an expiring reward when nothing is waiting', () => {
    const action = chooseSuggestedAction({
      ...base,
      expiringRewards: [{ name: 'Cinema trip', expiresAt: new Date() }],
    });
    expect(action).toContain('Cinema trip');
  });

  it('celebrates the longest streak when nothing needs the parent', () => {
    const action = chooseSuggestedAction({
      ...base,
      children: [
        { childId: 'a', firstName: 'Ada', tasksApproved: 2, pointsEarned: 10, pointsSpent: 0, currentStreak: 3, achievementsUnlocked: 0 },
        { childId: 'b', firstName: 'Ben', tasksApproved: 2, pointsEarned: 10, pointsSpent: 0, currentStreak: 9, achievementsUnlocked: 0 },
      ] as never,
    });
    expect(action).toContain('Ben');
    expect(action).toContain('9-day streak');
  });

  it('names a child who finished nothing, when no one is on a streak', () => {
    const action = chooseSuggestedAction({
      ...base,
      children: [
        { childId: 'a', firstName: 'Ada', tasksApproved: 0, pointsEarned: 0, pointsSpent: 0, currentStreak: 0, achievementsUnlocked: 0 },
      ] as never,
    });
    expect(action).toContain('Ada');
  });

  it('always returns something rather than an empty string', () => {
    expect(chooseSuggestedAction(base).length).toBeGreaterThan(0);
  });
});

describe('digest open tracking', () => {
  it('produces a stable signature for the same family and week', () => {
    expect(signDigestOpen(FAMILY, '2026-07-20')).toBe(signDigestOpen(FAMILY, '2026-07-20'));
  });

  it('cannot be replayed against another family', () => {
    expect(signDigestOpen(FAMILY, '2026-07-20')).not.toBe(signDigestOpen('fam-2', '2026-07-20'));
  });

  it('cannot be replayed against another week', () => {
    expect(signDigestOpen(FAMILY, '2026-07-20')).not.toBe(signDigestOpen(FAMILY, '2026-07-27'));
  });

  it('keys a week to its Monday, whatever day it is read on', () => {
    expect(weekKey(new Date('2026-07-22T23:00:00Z'))).toBe('2026-07-20');
    expect(weekKey(new Date('2026-07-26T01:00:00Z'))).toBe('2026-07-20');
  });
});
