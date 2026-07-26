/**
 * U17 — team-up tasks (growth roadmap §6).
 *
 * The arithmetic here is trivial; the *rules* are where this can go wrong, and each of the tests
 * below defends one that would be damaging in a way nobody would report as a bug:
 *
 *  - Splitting the base points would make teaming up worth LESS per child than working alone.
 *  - Paying only the child approved last would reward withholding — the same incentive argued
 *    against for collaborative rewards.
 *  - Paying twice under a co-parent race would mint points from nothing.
 *  - Writing the balance without a ledger row would make PointsLedgerReport stop reconciling.
 */

jest.mock('../src/services/database', () => {
  const tx = {
    childProfile: { findUnique: jest.fn(), update: jest.fn() },
    pointsLedger: { create: jest.fn() },
  };
  return {
    prisma: {
      task: { findUnique: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

import { awardTeamBonusIfComplete, teamProgress } from '../src/services/TeamTaskService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  task: { findUnique: jest.Mock; updateMany: jest.Mock };
  $transaction: jest.Mock;
  __tx: {
    childProfile: { findUnique: jest.Mock; update: jest.Mock };
    pointsLedger: { create: jest.Mock };
  };
};

const TASK = 'task-1';
const PARENT = 'parent-1';

function task(over: Record<string, unknown> = {}) {
  return {
    id: TASK,
    title: 'Tidy the garage',
    isTeamTask: true,
    teamBonusPoints: 15,
    teamBonusAwardedAt: null,
    assignments: [
      { childId: 'c1', status: 'approved' },
      { childId: 'c2', status: 'approved' },
    ],
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.task.findUnique.mockResolvedValue(task());
  p.task.updateMany.mockResolvedValue({ count: 1 });
  p.__tx.childProfile.findUnique.mockResolvedValue({ pointsBalance: 100 });
});

// ─── teamProgress ─────────────────────────────────────────────────────────────

describe('teamProgress', () => {
  it('counts approvals and submissions separately', () => {
    const progress = teamProgress([
      { childId: 'c1', status: 'approved' },
      { childId: 'c2', status: 'completed' },
      { childId: 'c3', status: 'pending' },
    ]);
    expect(progress).toMatchObject({ total: 3, approved: 1, submitted: 2, complete: false });
  });

  it('names who is still outstanding — the cooperation signal', () => {
    const progress = teamProgress([
      { childId: 'c1', status: 'approved' },
      { childId: 'c2', status: 'pending' },
    ]);
    expect(progress.outstanding).toEqual(['c2']);
  });

  it('is complete only when every member is approved', () => {
    expect(teamProgress([
      { childId: 'c1', status: 'approved' },
      { childId: 'c2', status: 'approved' },
    ]).complete).toBe(true);
  });

  it('is NOT complete when a member merely submitted', () => {
    // A parent still has to approve. Paying on submission would pay for unreviewed work.
    expect(teamProgress([
      { childId: 'c1', status: 'approved' },
      { childId: 'c2', status: 'completed' },
    ]).complete).toBe(false);
  });

  it('refuses to call a single child a completed team', () => {
    // A "team" task that ended up with one assignee must not quietly pay a bonus for solo work.
    expect(teamProgress([{ childId: 'c1', status: 'approved' }]).complete).toBe(false);
  });

  it('handles an empty task', () => {
    expect(teamProgress([])).toMatchObject({ total: 0, complete: false, outstanding: [] });
  });
});

// ─── awardTeamBonusIfComplete ─────────────────────────────────────────────────

describe('awardTeamBonusIfComplete', () => {
  // AC-U17b / AC-U17c
  it('pays every member the same bonus when the last one is approved', async () => {
    const result = await awardTeamBonusIfComplete(TASK, PARENT);

    expect(result).toEqual({ awarded: true, pointsEach: 15, childIds: ['c1', 'c2'] });
    expect(p.__tx.pointsLedger.create).toHaveBeenCalledTimes(2);
  });

  it('pays the member approved FIRST exactly as much as the one approved last', async () => {
    // Paying only the finisher would reward being last — the withholding incentive this design
    // exists to avoid.
    await awardTeamBonusIfComplete(TASK, PARENT);

    const amounts = p.__tx.pointsLedger.create.mock.calls.map((c) => c[0].data.pointsAmount);
    expect(amounts).toEqual([15, 15]);
  });

  // AC-U17e — the rule from U8.
  it('moves points through the LEDGER with a balanceAfter, never a bare balance write', async () => {
    await awardTeamBonusIfComplete(TASK, PARENT);

    const row = p.__tx.pointsLedger.create.mock.calls[0][0].data;
    expect(row).toMatchObject({
      transactionType: 'bonus',
      pointsAmount: 15,
      balanceAfter: 115, // 100 + 15, read inside the same transaction
      referenceType: 'team_bonus',
      referenceId: TASK,
    });
    // And the profile update carries the same figure, so the two can never disagree.
    expect(p.__tx.childProfile.update.mock.calls[0][0].data.pointsBalance).toBe(115);
  });

  it('increments lifetime earnings as well as the spendable balance', async () => {
    await awardTeamBonusIfComplete(TASK, PARENT);
    expect(p.__tx.childProfile.update.mock.calls[0][0].data.totalPointsEarned).toEqual({
      increment: 15,
    });
  });

  // AC-U17b
  it('pays nothing while a member is still outstanding', async () => {
    p.task.findUnique.mockResolvedValue(
      task({ assignments: [{ childId: 'c1', status: 'approved' }, { childId: 'c2', status: 'pending' }] }),
    );

    expect((await awardTeamBonusIfComplete(TASK, PARENT)).awarded).toBe(false);
    expect(p.task.updateMany).not.toHaveBeenCalled();
  });

  // AC-U17f
  it('pays nothing when a member was rejected, and touches no one else', async () => {
    p.task.findUnique.mockResolvedValue(
      task({ assignments: [{ childId: 'c1', status: 'approved' }, { childId: 'c2', status: 'rejected' }] }),
    );

    expect((await awardTeamBonusIfComplete(TASK, PARENT)).awarded).toBe(false);
    // The approved sibling keeps their base points — nothing here reverses them.
    expect(p.__tx.pointsLedger.create).not.toHaveBeenCalled();
    expect(p.__tx.childProfile.update).not.toHaveBeenCalled();
  });

  it('pays nothing when a member expired', async () => {
    p.task.findUnique.mockResolvedValue(
      task({ assignments: [{ childId: 'c1', status: 'approved' }, { childId: 'c2', status: 'expired' }] }),
    );
    expect((await awardTeamBonusIfComplete(TASK, PARENT)).awarded).toBe(false);
  });

  // AC-U17d — the race that would mint points from nothing.
  it('awards exactly once when two approvals race', async () => {
    // The claim is a conditional update; the loser matches no row and must pay nothing, even though
    // it read the same "complete" state a moment earlier.
    p.task.updateMany.mockResolvedValue({ count: 0 });

    expect((await awardTeamBonusIfComplete(TASK, PARENT)).awarded).toBe(false);
    expect(p.__tx.pointsLedger.create).not.toHaveBeenCalled();
  });

  it('claims before paying, not after', async () => {
    await awardTeamBonusIfComplete(TASK, PARENT);
    expect(p.task.updateMany).toHaveBeenCalledWith({
      where: { id: TASK, teamBonusAwardedAt: null },
      data: { teamBonusAwardedAt: expect.any(Date) },
    });
  });

  it('never pays twice for an already-settled task', async () => {
    p.task.findUnique.mockResolvedValue(task({ teamBonusAwardedAt: new Date() }));
    expect((await awardTeamBonusIfComplete(TASK, PARENT)).awarded).toBe(false);
  });

  // AC-U17g
  it('does nothing at all for an ordinary task', async () => {
    p.task.findUnique.mockResolvedValue(task({ isTeamTask: false }));

    expect((await awardTeamBonusIfComplete(TASK, PARENT)).awarded).toBe(false);
    expect(p.task.updateMany).not.toHaveBeenCalled();
    expect(p.$transaction).not.toHaveBeenCalled();
  });

  it('does nothing when the bonus is zero', async () => {
    p.task.findUnique.mockResolvedValue(task({ teamBonusPoints: 0 }));
    expect((await awardTeamBonusIfComplete(TASK, PARENT)).awarded).toBe(false);
  });

  it('does nothing for a deleted or missing task', async () => {
    p.task.findUnique.mockResolvedValue(null);
    expect((await awardTeamBonusIfComplete(TASK, PARENT)).awarded).toBe(false);
  });

  it('skips a member whose profile is missing rather than throwing', async () => {
    p.__tx.childProfile.findUnique.mockResolvedValueOnce(null);
    const result = await awardTeamBonusIfComplete(TASK, PARENT);

    expect(result.awarded).toBe(true);
    expect(p.__tx.pointsLedger.create).toHaveBeenCalledTimes(1); // only the member that exists
  });

  // The approval already succeeded by the time this runs.
  it('NEVER throws into the approval path', async () => {
    // Reporting a completed approval as failed — and prompting the parent to retry it — would be a
    // worse outcome than a missing bonus.
    p.task.findUnique.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(awardTeamBonusIfComplete(TASK, PARENT)).resolves.toEqual({
      awarded: false,
      pointsEach: 0,
      childIds: [],
    });
    jest.restoreAllMocks();
  });
});
