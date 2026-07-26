/**
 * tests/fixtures/parentDashboard.ts — the prisma mock shape `GET /dashboard/parent` needs.
 *
 * Built because that route's hand-rolled mock has broken FOUR times across this run: every unit that
 * added a read to the dashboard (evidence presigning, wishlist/comment counts, the pinned goal, and
 * now the traffic-light) also had to remember to widen a mock in a different file, and each time the
 * failure surfaced as a regression in tests that had nothing to do with the change.
 *
 * Anything added to the route should be added here once, so the next unit inherits it instead of
 * rediscovering the trap.
 */

export interface DashboardPrismaMock {
  family: { findUnique: jest.Mock };
  user: { findMany: jest.Mock };
  taskAssignment: { findMany: jest.Mock; count: jest.Mock };
  rewardWishlist: { groupBy: jest.Mock; findFirst: jest.Mock };
  taskComment: { groupBy: jest.Mock };
  childProfile: { findUnique: jest.Mock };
  task: { count: jest.Mock };
  pointsLedger: { aggregate: jest.Mock };
  rewardRedemption: { count: jest.Mock };
  $transaction: jest.Mock;
}

/** Every model + method the route touches. Pass into `jest.mock('../src/services/database', ...)`. */
export function makeDashboardPrismaMock(): DashboardPrismaMock {
  return {
    family: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    taskAssignment: { findMany: jest.fn(), count: jest.fn() },
    rewardWishlist: { groupBy: jest.fn(), findFirst: jest.fn() },
    taskComment: { groupBy: jest.fn() },
    childProfile: { findUnique: jest.fn() },
    task: { count: jest.fn() },
    pointsLedger: { aggregate: jest.fn() },
    rewardRedemption: { count: jest.fn() },
    $transaction: jest.fn(),
  };
}

/**
 * Sensible defaults for a one-child family with nothing unusual going on.
 *
 * Deliberately quiet: a test asserting one behaviour should set only what it cares about, and
 * anything it does not set should not fail. Call from `beforeEach`.
 */
export function primeDashboardDefaults(p: DashboardPrismaMock): void {
  p.family.findUnique.mockResolvedValue({ id: 'fam-1', familyName: 'Test Family' });
  p.user.findMany.mockImplementation(({ where }: { where: { role: string } }) =>
    where.role === 'parent'
      ? Promise.resolve([{ id: 'parent-1', firstName: 'Pat', lastName: 'P', isPrimaryParent: true }])
      : Promise.resolve([
          {
            id: 'child-1',
            firstName: 'Emma',
            lastName: 'C',
            passwordHash: 'secret',
            childProfile: { userId: 'child-1', pointsBalance: 40, pinHash: 'secret' },
          },
        ]),
  );
  p.taskAssignment.count.mockResolvedValue(0);
  p.taskAssignment.findMany.mockResolvedValue([]);
  p.rewardWishlist.groupBy.mockResolvedValue([]);
  p.rewardWishlist.findFirst.mockResolvedValue(null);
  p.taskComment.groupBy.mockResolvedValue([]);
  p.childProfile.findUnique.mockResolvedValue({ pointsBalance: 0 });
  p.task.count.mockResolvedValue(0);
  p.pointsLedger.aggregate.mockResolvedValue({ _sum: { pointsAmount: 0 } });
  p.rewardRedemption.count.mockResolvedValue(0);
  p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p));
}
