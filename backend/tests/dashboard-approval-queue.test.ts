/**
 * Parent dashboard: the data the inline approval queue depends on.
 *
 * Two things are guarded here because both fail SILENTLY in the UI rather than erroring:
 *
 *  1. Evidence presigning. F-4 made evidence private on R2, so the stored fileUrl is empty and the
 *     route must mint short-lived URLs. The dashboard used to only COUNT this list, so nothing
 *     noticed it was unsigned; now it renders thumbnails, and an unsigned row is a broken image.
 *
 *  2. weeklyStats.tasksCreated. The card existed and read 0 for every family because the API never
 *     returned the figure - a wrong number, not a crash.
 */

const mockWithEvidenceUrlsList = jest.fn();

jest.mock('../src/services/storage', () => ({
  withEvidenceUrlsList: (list: unknown[]) => mockWithEvidenceUrlsList(list),
}));

jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findUnique: jest.fn() },
    user: { findMany: jest.fn() },
    taskAssignment: { findMany: jest.fn(), count: jest.fn() },
    rewardWishlist: { groupBy: jest.fn() },
    taskComment: { groupBy: jest.fn() },
    task: { count: jest.fn() },
    pointsLedger: { aggregate: jest.fn() },
    rewardRedemption: { count: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../src/services/streakService', () => ({ isStreakAtRisk: jest.fn(() => false) }));
jest.mock('../src/services/ChallengeService', () => ({ getTodayChallenge: jest.fn() }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  familyIsolation: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireParent: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireChild: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { prisma } from '../src/services/database';
import { dashboardRouter } from '../src/routes/dashboard';

const p = prisma as unknown as {
  family: { findUnique: jest.Mock };
  user: { findMany: jest.Mock };
  taskAssignment: { findMany: jest.Mock; count: jest.Mock };
  rewardWishlist: { groupBy: jest.Mock };
  taskComment: { groupBy: jest.Mock };
  task: { count: jest.Mock };
  pointsLedger: { aggregate: jest.Mock };
  rewardRedemption: { count: jest.Mock };
  $transaction: jest.Mock;
};

/**
 * Drive the GET /dashboard/parent handler directly, without spinning up HTTP.
 *
 * Note: no jest.resetModules() here. Resetting would hand the re-imported route a DIFFERENT prisma
 * instance than the one configured below, and every mock would read as unset.
 */
async function callParentDashboard() {
  // The parent route is the first GET registered on the router.
  const layer = (dashboardRouter as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>;
  }).stack.find((l) => l.route?.path === '/parent' && l.route.methods.get);

  const handlers = layer!.route!.stack.map((s) => s.handle) as Array<
    (req: unknown, res: unknown, next: (e?: unknown) => void) => Promise<void>
  >;
  const handler = handlers[handlers.length - 1];

  const json = jest.fn();
  const req = { familyId: 'fam-1', user: { userId: 'parent-1' } };
  const res = { json };
  const next = jest.fn((e?: unknown) => {
    if (e) throw e;
  });

  await handler(req, res, next);
  expect(next).not.toHaveBeenCalledWith(expect.anything());
  return json.mock.calls[0][0].data;
}

describe('GET /dashboard/parent', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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
    p.taskAssignment.count.mockResolvedValue(1);
    p.taskAssignment.findMany.mockResolvedValue([
      {
        id: 'assign-1',
        child: { id: 'child-1', firstName: 'Emma' },
        task: { id: 'task-1', title: 'Tidy room' },
        // Exactly what R2 returns: keys present, URL empty until presigned.
        evidence: [{ id: 'ev-1', evidenceType: 'photo', fileKey: 'k/1.jpg', fileUrl: '' }],
      },
    ]);
    p.rewardWishlist.groupBy.mockResolvedValue([{ childId: 'child-1', _count: { _all: 3 } }]);
    p.taskComment.groupBy.mockResolvedValue([{ authorId: 'child-1', _count: { _all: 2 } }]);

    // weeklyStats runs inside a transaction; hand the callback the same mocks.
    p.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(p));
    p.task.count.mockResolvedValue(7);
    p.pointsLedger.aggregate.mockResolvedValue({ _sum: { pointsAmount: 120 } });
    p.rewardRedemption.count.mockResolvedValue(2);

    mockWithEvidenceUrlsList.mockImplementation((list: Array<Record<string, unknown>>) =>
      Promise.resolve(list.map((e) => ({ ...e, fileUrl: 'https://signed.example/x', thumbnailUrl: 'https://signed.example/t' }))),
    );
  });

  it('presigns the evidence on every pending approval', async () => {
    const data = await callParentDashboard();

    expect(mockWithEvidenceUrlsList).toHaveBeenCalledTimes(1);
    // The queue renders this URL; an empty string here is a broken thumbnail in the UI.
    expect(data.pendingApprovals[0].evidence[0].fileUrl).toBe('https://signed.example/x');
    expect(data.pendingApprovals[0].evidence[0].thumbnailUrl).toBe('https://signed.example/t');
  });

  it('returns the pending approvals as a list, not just a count', async () => {
    const data = await callParentDashboard();
    expect(Array.isArray(data.pendingApprovals)).toBe(true);
    expect(data.pendingApprovals[0]).toMatchObject({ id: 'assign-1' });
  });

  it('returns weeklyStats.tasksCreated so the card is not permanently 0', async () => {
    const data = await callParentDashboard();
    expect(data.weeklyStats.tasksCreated).toBe(7);
  });

  it('attaches the wishlist and comment counts each child card shows', async () => {
    const data = await callParentDashboard();
    expect(data.children[0]).toMatchObject({ wishlistCount: 3, recentCommentCount: 2 });
  });

  it('defaults engagement counts to 0 for a child with neither', async () => {
    p.rewardWishlist.groupBy.mockResolvedValue([]);
    p.taskComment.groupBy.mockResolvedValue([]);
    const data = await callParentDashboard();
    expect(data.children[0]).toMatchObject({ wishlistCount: 0, recentCommentCount: 0 });
  });

  it('never leaks the child password hash or PIN hash', async () => {
    const data = await callParentDashboard();
    expect(data.children[0].user.passwordHash).toBeUndefined();
    expect(data.children[0].user.childProfile.pinHash).toBeUndefined();
  });
});
