import { TaskService } from '../src/services/TaskService';

/**
 * FR-03 — business-logic coverage for the points ledger. Until now every test in this repo was
 * security-focused; the ledger, which is the app's actual accounting record, had none.
 *
 * The invariant being pinned is `balanceAfter == previous balance + pointsAmount`, and that
 * corrections are appended rather than written over history.
 */
jest.mock('../src/services/database', () => {
  const tx = {
    taskAssignment: { update: jest.fn() },
    childProfile: { update: jest.fn() },
    pointsLedger: { create: jest.fn() },
  };
  return {
    prisma: {
      taskAssignment: { findFirst: jest.fn(), update: jest.fn() },
      pointsLedger: { create: jest.fn(), findMany: jest.fn() },
      childProfile: { update: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});
jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn(), sendToFamilyParents: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../src/routes/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../src/services/database';

const db = prisma as unknown as {
  taskAssignment: { findFirst: jest.Mock };
  __tx: {
    taskAssignment: { update: jest.Mock };
    childProfile: { update: jest.Mock };
    pointsLedger: { create: jest.Mock };
  };
};

const approvedAssignment = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  childId: 'child-1',
  taskId: 't1',
  pointsAwarded: 50,
  xpAwarded: 20,
  task: { id: 't1', title: 'Wash up', difficulty: 'medium', pointsValue: 50 },
  child: {
    id: 'child-1',
    firstName: 'Sam',
    childProfile: { userId: 'child-1', pointsBalance: 120, level: 3 },
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  db.__tx.taskAssignment.update.mockResolvedValue({ id: 'a1', status: 'rejected' });
  db.__tx.childProfile.update.mockResolvedValue({});
  db.__tx.pointsLedger.create.mockResolvedValue({});
});

describe('revokeApproval writes an append-only reversal (FR-03)', () => {
  it('appends a NEGATIVE ledger row rather than editing or deleting the original', async () => {
    db.taskAssignment.findFirst.mockResolvedValue(approvedAssignment());

    await TaskService.revokeApproval({
      assignmentId: 'a1',
      familyId: 'f1',
      parentId: 'p1',
      reason: 'Not actually done',
    });

    const row = db.__tx.pointsLedger.create.mock.calls[0][0].data;
    expect(row.pointsAmount).toBe(-50);
    expect(row.childId).toBe('child-1');
    expect(row.referenceId).toBe('a1');
    // The original earning row is never touched — only a new row is written.
    expect(db.__tx.pointsLedger.create).toHaveBeenCalledTimes(1);
  });

  it('keeps balanceAfter consistent with the reversal amount', async () => {
    db.taskAssignment.findFirst.mockResolvedValue(approvedAssignment());

    const result = await TaskService.revokeApproval({
      assignmentId: 'a1',
      familyId: 'f1',
      parentId: 'p1',
    });

    const row = db.__tx.pointsLedger.create.mock.calls[0][0].data;
    expect(row.balanceAfter).toBe(120 - 50); // previous balance + pointsAmount
    expect(result.newBalance).toBe(70);
  });

  it('lets the balance go NEGATIVE when the child already spent the points', async () => {
    // Deliberate: clamping at zero would let a child keep value that was withdrawn and would break
    // `balance == sum(entries)`. Redemption checks affordability, so a negative balance simply
    // blocks further spending until it is earned back.
    db.taskAssignment.findFirst.mockResolvedValue(
      approvedAssignment({
        child: {
          id: 'child-1',
          firstName: 'Sam',
          childProfile: { userId: 'child-1', pointsBalance: 10, level: 3 },
        },
      }),
    );

    const result = await TaskService.revokeApproval({
      assignmentId: 'a1',
      familyId: 'f1',
      parentId: 'p1',
    });

    expect(result.newBalance).toBe(-40);
    expect(db.__tx.pointsLedger.create.mock.calls[0][0].data.balanceAfter).toBe(-40);
  });

  it('reverses points, XP and the completed-task count together', async () => {
    db.taskAssignment.findFirst.mockResolvedValue(approvedAssignment());

    await TaskService.revokeApproval({ assignmentId: 'a1', familyId: 'f1', parentId: 'p1' });

    const data = db.__tx.childProfile.update.mock.calls[0][0].data;
    expect(data.pointsBalance).toBe(70);
    expect(data.totalPointsEarned).toEqual({ decrement: 50 });
    expect(data.totalXpEarned).toEqual({ decrement: 20 });
    expect(data.totalTasksCompleted).toEqual({ decrement: 1 });
  });

  it('does NOT de-level the child — levels and their bonuses are left alone', async () => {
    db.taskAssignment.findFirst.mockResolvedValue(approvedAssignment());

    await TaskService.revokeApproval({ assignmentId: 'a1', familyId: 'f1', parentId: 'p1' });

    const data = db.__tx.childProfile.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('level');
  });

  it('clears the approval fields so the assignment cannot be revoked twice', async () => {
    db.taskAssignment.findFirst.mockResolvedValue(approvedAssignment());

    await TaskService.revokeApproval({ assignmentId: 'a1', familyId: 'f1', parentId: 'p1' });

    const data = db.__tx.taskAssignment.update.mock.calls[0][0].data;
    expect(data.status).toBe('rejected');
    expect(data.approvedAt).toBeNull();
    expect(data.pointsAwarded).toBe(0);
    expect(data.xpAwarded).toBe(0);
  });

  it('refuses an assignment that is not approved (cross-family or wrong status)', async () => {
    db.taskAssignment.findFirst.mockResolvedValue(null);

    await expect(
      TaskService.revokeApproval({ assignmentId: 'a1', familyId: 'other-family', parentId: 'p1' }),
    ).rejects.toThrow(/not found/i);

    expect(db.__tx.pointsLedger.create).not.toHaveBeenCalled();
  });

  it('scopes the lookup to the caller family and the approved status', async () => {
    db.taskAssignment.findFirst.mockResolvedValue(approvedAssignment());

    await TaskService.revokeApproval({ assignmentId: 'a1', familyId: 'f1', parentId: 'p1' });

    const where = db.taskAssignment.findFirst.mock.calls[0][0].where;
    expect(where.status).toBe('approved');
    expect(where.task.familyId).toBe('f1');
  });
});
