/**
 * U18 — the child's "My Week" recap (growth roadmap §6).
 *
 * The parent has had a weekly digest since U3; this is the child-facing half of the same ritual.
 *
 * Most of what matters here is restraint rather than computation:
 *
 *  - **No sibling data**, asserted on the payload rather than left to the UI not to render it. The
 *    leaderboard is opt-out-able by design; a recap naming a sibling's totals would smuggle the
 *    comparison back in through a surface with no opt out.
 *  - **A quiet week says so**, because a child reads "you crushed it!" over zero tasks as the app
 *    not paying attention.
 *  - **The same week window as the parent digest**, or a parent and child in one family would
 *    disagree about what happened with no way to tell who was right.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    taskAssignment: { findMany: jest.fn() },
    pointsLedger: { findMany: jest.fn() },
    childAchievement: { findMany: jest.fn() },
    gameSession: { count: jest.fn() },
    task: { findMany: jest.fn() },
  },
}));

import { buildWeekRecap } from '../src/services/RecapService';
import { lastWeekWindow } from '../src/services/DigestService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  user: { findUnique: jest.Mock };
  taskAssignment: { findMany: jest.Mock };
  pointsLedger: { findMany: jest.Mock };
  childAchievement: { findMany: jest.Mock };
  gameSession: { count: jest.Mock };
  task: { findMany: jest.Mock };
};

const CHILD = 'child-1';
// A Wednesday, so "last week" is unambiguous.
const NOW = new Date('2026-07-22T09:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  p.user.findUnique.mockResolvedValue({
    firstName: 'Emma',
    childProfile: { currentStreakDays: 4, longestStreakDays: 11 },
  });
  p.taskAssignment.findMany.mockResolvedValue([]);
  p.pointsLedger.findMany.mockResolvedValue([]);
  p.childAchievement.findMany.mockResolvedValue([]);
  p.gameSession.count.mockResolvedValue(0);
  p.task.findMany.mockResolvedValue([]);
});

// ─── AC-U18b ──────────────────────────────────────────────────────────────────

describe('the week window', () => {
  it('is exactly the window the parent digest uses', () => {
    // Not a re-implementation — the same exported helper. If these ever diverged, a parent and
    // child looking at one family would describe different weeks.
    const expected = lastWeekWindow(NOW);
    return buildWeekRecap(CHILD, NOW).then((recap) => {
      expect(recap.weekStart).toBe(expected.weekStart.toISOString());
      expect(recap.weekEnd).toBe(expected.weekEnd.toISOString());
    });
  });

  it('bounds every query to that window', async () => {
    const { weekStart, weekEnd } = lastWeekWindow(NOW);
    await buildWeekRecap(CHILD, NOW);

    expect(p.taskAssignment.findMany.mock.calls[0][0].where.approvedAt).toEqual({
      gte: weekStart,
      lt: weekEnd,
    });
    expect(p.pointsLedger.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: weekStart,
      lt: weekEnd,
    });
  });
});

// ─── AC-U18c / AC-U18g: scope ─────────────────────────────────────────────────

describe('scope', () => {
  it('queries only this child', async () => {
    await buildWeekRecap(CHILD, NOW);
    for (const call of [
      p.taskAssignment.findMany.mock.calls[0][0],
      p.pointsLedger.findMany.mock.calls[0][0],
      p.childAchievement.findMany.mock.calls[0][0],
      p.gameSession.count.mock.calls[0][0],
    ]) {
      expect(call.where.childId).toBe(CHILD);
    }
  });

  it('contains no sibling data anywhere in the payload', async () => {
    // Asserted on the serialised payload, not left to the UI: the leaderboard is opt-out-able, and
    // this surface has no opt out to offer.
    p.taskAssignment.findMany.mockResolvedValue([{ approvedAt: new Date('2026-07-15T10:00:00Z') }]);

    const recap = await buildWeekRecap(CHILD, NOW);
    const serialised = JSON.stringify(recap);

    expect(serialised).not.toMatch(/sibling|compare|rank|leaderboard|vs\b/i);
    expect(Object.keys(recap)).not.toContain('children');
    expect(recap.childId).toBe(CHILD);
  });
});

// ─── AC-U18a / AC-U18f: the figures ───────────────────────────────────────────

describe('the figures', () => {
  it('counts approvals in the window', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      { approvedAt: new Date('2026-07-14T10:00:00Z') },
      { approvedAt: new Date('2026-07-15T10:00:00Z') },
    ]);
    expect((await buildWeekRecap(CHILD, NOW)).tasksApproved).toBe(2);
  });

  it('takes points from the LEDGER so the recap and R-02 agree', async () => {
    p.pointsLedger.findMany.mockResolvedValue([
      { pointsAmount: 30 },
      { pointsAmount: 15 },
      { pointsAmount: -20 }, // a redemption
    ]);

    const recap = await buildWeekRecap(CHILD, NOW);
    expect(recap.pointsEarned).toBe(45);
    expect(recap.pointsSpent).toBe(20);
  });

  it('splits earned from spent by SIGN, not by transaction type', async () => {
    // A transaction type added later would otherwise vanish from one side of the summary.
    p.pointsLedger.findMany.mockResolvedValue([{ pointsAmount: 5 }, { pointsAmount: -5 }]);
    const recap = await buildWeekRecap(CHILD, NOW);
    expect([recap.pointsEarned, recap.pointsSpent]).toEqual([5, 5]);
  });

  it('reports the busiest day', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      { approvedAt: new Date('2026-07-14T09:00:00Z') },
      { approvedAt: new Date('2026-07-16T09:00:00Z') },
      { approvedAt: new Date('2026-07-16T18:00:00Z') },
    ]);
    expect((await buildWeekRecap(CHILD, NOW)).bestDay).toEqual({
      date: '2026-07-16',
      tasksApproved: 2,
    });
  });

  // AC-U18e
  it('leaves the best day NULL when nothing was approved', async () => {
    // An arbitrary Monday would be a small invented fact, and children notice invented facts.
    expect((await buildWeekRecap(CHILD, NOW)).bestDay).toBeNull();
  });

  it('carries the streak and achievements', async () => {
    p.childAchievement.findMany.mockResolvedValue([
      { achievement: { name: 'Early Bird', iconUrl: '/badges/early.png' } },
    ]);

    const recap = await buildWeekRecap(CHILD, NOW);
    expect(recap.currentStreak).toBe(4);
    expect(recap.longestStreak).toBe(11);
    expect(recap.achievementsUnlocked).toEqual([{ name: 'Early Bird', icon: '/badges/early.png' }]);
  });

  it('counts team-ups the child was part of', async () => {
    p.task.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    expect((await buildWeekRecap(CHILD, NOW)).teamUpsCompleted).toBe(2);
  });

  it('counts only team-ups whose bonus landed IN the window', async () => {
    await buildWeekRecap(CHILD, NOW);
    const where = p.task.findMany.mock.calls[0][0].where;
    expect(where.isTeamTask).toBe(true);
    const { weekStart, weekEnd } = lastWeekWindow(NOW);
    expect(where.teamBonusAwardedAt).toEqual({ gte: weekStart, lt: weekEnd });
    expect(where.assignments.some.childId).toBe(CHILD);
  });
});

// ─── AC-U18d: the quiet week ──────────────────────────────────────────────────

describe('a quiet week', () => {
  it('returns a valid recap of zeroes, not an error', async () => {
    const recap = await buildWeekRecap(CHILD, NOW);
    expect(recap).toMatchObject({
      tasksApproved: 0,
      pointsEarned: 0,
      pointsSpent: 0,
      gamesPlayed: 0,
      teamUpsCompleted: 0,
      quietWeek: true,
    });
  });

  it('is NOT quiet when the child played a game but finished no tasks', async () => {
    // Something happened. Telling that child their week was empty would be wrong.
    p.gameSession.count.mockResolvedValue(3);
    expect((await buildWeekRecap(CHILD, NOW)).quietWeek).toBe(false);
  });

  it('is NOT quiet when only an achievement landed', async () => {
    p.childAchievement.findMany.mockResolvedValue([{ achievement: { name: 'Streak', iconUrl: null } }]);
    expect((await buildWeekRecap(CHILD, NOW)).quietWeek).toBe(false);
  });

  it('survives a child with no profile row', async () => {
    p.user.findUnique.mockResolvedValue(null);
    const recap = await buildWeekRecap(CHILD, NOW);
    expect(recap.currentStreak).toBe(0);
    expect(recap.firstName).toBe('');
  });
});
