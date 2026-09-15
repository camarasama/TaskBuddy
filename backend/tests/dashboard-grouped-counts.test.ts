/**
 * The parent dashboard derives each child's today/completed/pending counts from THREE grouped queries
 * (one per metric, across all children) rather than three counts per child. This pins that the right
 * count lands on the right child, and that a child absent from a groupBy result reads 0 - the exact
 * behaviour the old per-child count had (security audit follow-up / 2026-09-15 load test).
 */
jest.mock('../src/services/storage', () => ({ withEvidenceUrlsList: (l: unknown[]) => Promise.resolve(l) }));
jest.mock('../src/services/database', () => {
  const { makeDashboardPrismaMock } = require('./fixtures/parentDashboard');
  return { prisma: makeDashboardPrismaMock() };
});
jest.mock('../src/services/streakService', () => ({ isStreakAtRisk: jest.fn().mockResolvedValue(false) }));
jest.mock('../src/services/ChallengeService', () => ({ getTodayChallenge: jest.fn() }));
jest.mock('../src/services/GoalService', () => ({ GoalService: { getGoal: jest.fn().mockResolvedValue(null) } }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  familyIsolation: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireParent: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireChild: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { prisma } from '../src/services/database';
import { dashboardRouter } from '../src/routes/dashboard';
import { primeDashboardDefaults, DashboardPrismaMock } from './fixtures/parentDashboard';

const p = prisma as unknown as DashboardPrismaMock;

async function callParentDashboard() {
  const layer = (dashboardRouter as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>;
  }).stack.find((l) => l.route?.path === '/parent' && l.route.methods.get);
  const handlers = layer!.route!.stack.map((s) => s.handle) as Array<
    (req: unknown, res: unknown, next: (e?: unknown) => void) => Promise<void>
  >;
  const json = jest.fn();
  const next = jest.fn((e?: unknown) => { if (e) throw e; });
  await handlers[handlers.length - 1]({ familyId: 'fam-1', user: { userId: 'parent-1' } }, { json }, next);
  return json.mock.calls[0][0].data;
}

describe('parent dashboard grouped per-child counts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    primeDashboardDefaults(p);
    // A two-child family.
    p.user.findMany.mockImplementation(({ where }: { where: { role: string } }) =>
      where.role === 'parent'
        ? Promise.resolve([{ id: 'parent-1', firstName: 'Pat', lastName: 'P', isPrimaryParent: true }])
        : Promise.resolve([
            { id: 'c1', firstName: 'Ama', lastName: 'K', childProfile: { userId: 'c1', pointsBalance: 10 } },
            { id: 'c2', firstName: 'Ben', lastName: 'K', childProfile: { userId: 'c2', pointsBalance: 20 } },
          ]),
    );
  });

  it('maps each grouped count to the right child and defaults a missing child to 0', async () => {
    // todays: c1=3, c2=1 ; completed: c1=3 (none for c2) ; pending: c2=2 (none for c1)
    p.taskAssignment.groupBy
      .mockResolvedValueOnce([{ childId: 'c1', _count: { _all: 3 } }, { childId: 'c2', _count: { _all: 1 } }])
      .mockResolvedValueOnce([{ childId: 'c1', _count: { _all: 3 } }])
      .mockResolvedValueOnce([{ childId: 'c2', _count: { _all: 2 } }]);

    const data = await callParentDashboard();
    const byId = Object.fromEntries(data.children.map((c: { user: { id: string } }) => [c.user.id, c]));

    expect(byId.c1).toMatchObject({ todaysTasks: 3, completedToday: 3, pendingApproval: 0, todayStatus: 'done' });
    expect(byId.c2).toMatchObject({ todaysTasks: 1, completedToday: 0, pendingApproval: 2, todayStatus: 'none' });
  });

  it('uses three grouped queries, not three-per-child', async () => {
    p.taskAssignment.groupBy.mockResolvedValue([]);
    await callParentDashboard();
    // three groupBy calls total, regardless of the two children
    expect(p.taskAssignment.groupBy).toHaveBeenCalledTimes(3);
    // and each is scoped to both children in one query
    expect(p.taskAssignment.groupBy.mock.calls[0][0].where.childId).toEqual({ in: ['c1', 'c2'] });
  });

  it('runs no grouped query when the family has no children', async () => {
    p.user.findMany.mockImplementation(({ where }: { where: { role: string } }) =>
      where.role === 'parent'
        ? Promise.resolve([{ id: 'parent-1', firstName: 'Pat', lastName: 'P', isPrimaryParent: true }])
        : Promise.resolve([]),
    );
    const data = await callParentDashboard();
    expect(p.taskAssignment.groupBy).not.toHaveBeenCalled();
    expect(data.children).toEqual([]);
  });
});
