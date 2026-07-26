/**
 * U11 — parent command centre (growth roadmap §5.1).
 *
 * Three additions, each answering "what needs me right now" rather than "what happened":
 *  - a traffic-light per child, derived SERVER-side so two surfaces cannot disagree;
 *  - streaks at risk today, which the child dashboard has known since M9 and the parent — the person
 *    who can act on it — has never been shown;
 *  - this week vs last, as a delta rather than two numbers the reader subtracts.
 *
 * Uses the shared dashboard fixture. That fixture exists because this route's hand-rolled mock broke
 * four times as units added reads to it.
 */

jest.mock('../src/services/database', () => {
  const { makeDashboardPrismaMock } = require('./fixtures/parentDashboard');
  return { prisma: makeDashboardPrismaMock() };
});

jest.mock('../src/services/storage', () => ({
  withEvidenceUrlsList: (list: unknown[]) => Promise.resolve(list),
}));
const mockAtRisk = jest.fn();
jest.mock('../src/services/streakService', () => ({
  isStreakAtRisk: (...args: unknown[]) => mockAtRisk(...args),
}));
jest.mock('../src/services/ChallengeService', () => ({ getTodayChallenge: jest.fn() }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (_q: unknown, _s: unknown, n: () => void) => n(),
  familyIsolation: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireParent: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireChild: (_q: unknown, _s: unknown, n: () => void) => n(),
}));

import { prisma } from '../src/services/database';
import { dashboardRouter } from '../src/routes/dashboard';
import {
  primeDashboardDefaults,
  type DashboardPrismaMock,
} from './fixtures/parentDashboard';

const p = prisma as unknown as DashboardPrismaMock;

async function callDashboard() {
  const layer = (dashboardRouter as unknown as {
    stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }>;
  }).stack.find((l) => l.route?.path === '/parent' && l.route.methods.get);

  const handlers = layer!.route!.stack.map((s) => s.handle) as Array<
    (req: unknown, res: unknown, next: (e?: unknown) => void) => Promise<void>
  >;
  const json = jest.fn();
  let caught: unknown;
  await handlers[handlers.length - 1](
    { familyId: 'fam-1', user: { userId: 'parent-1' } },
    { json },
    (e?: unknown) => { caught = e; },
  );
  if (caught) throw caught;
  return json.mock.calls[0][0].data;
}

/** todaysTasks / completedToday, in the order the route's Promise.all resolves them. */
function primeCounts(todaysTasks: number, completedToday: number, pending = 0) {
  p.taskAssignment.count
    .mockResolvedValueOnce(todaysTasks)
    .mockResolvedValueOnce(completedToday)
    .mockResolvedValueOnce(pending)
    // Remaining calls (weeklyStats: approved this week, approved last week) default to 0.
    .mockResolvedValue(0);
}

beforeEach(() => {
  jest.clearAllMocks();
  primeDashboardDefaults(p);
  mockAtRisk.mockResolvedValue(false);
});

// ─── AC-U11a: traffic light ───────────────────────────────────────────────────

describe('traffic light', () => {
  it('is "done" when everything assigned today is finished', async () => {
    primeCounts(3, 3);
    const data = await callDashboard();
    expect(data.children[0].todayStatus).toBe('done');
  });

  it('is "in_progress" when some but not all are finished', async () => {
    primeCounts(3, 1);
    const data = await callDashboard();
    expect(data.children[0].todayStatus).toBe('in_progress');
  });

  it('is "none" when nothing has been started', async () => {
    primeCounts(3, 0);
    const data = await callDashboard();
    expect(data.children[0].todayStatus).toBe('none');
  });

  it('is "none" — not a red flag — for a child with nothing assigned', async () => {
    // An empty day is not a failure. Colouring it as one trains parents to ignore the signal.
    primeCounts(0, 0);
    const data = await callDashboard();
    expect(data.children[0].todayStatus).toBe('none');
  });

  it('is "done" if more were completed than assigned', async () => {
    // Self-assigned bonus tasks can exceed the day's count; that is not "in progress".
    primeCounts(2, 5);
    const data = await callDashboard();
    expect(data.children[0].todayStatus).toBe('done');
  });
});

// ─── AC-U11b: streaks at risk ─────────────────────────────────────────────────

describe('streak at risk', () => {
  it('surfaces the flag to the parent', async () => {
    primeCounts(1, 0);
    mockAtRisk.mockResolvedValue(true);
    const data = await callDashboard();
    expect(data.children[0].streakAtRisk).toBe(true);
  });

  it('degrades to false when the check throws, rather than failing the dashboard', async () => {
    // One child's streak calculation must never take out the whole page.
    primeCounts(1, 0);
    mockAtRisk.mockRejectedValue(new Error('db hiccup'));
    const data = await callDashboard();
    expect(data.children[0].streakAtRisk).toBe(false);
  });

  it('does not require the helper to be async', async () => {
    // Wrapped in Promise.resolve so the route is not coupled to that staying true.
    primeCounts(1, 0);
    mockAtRisk.mockReturnValue(true);
    const data = await callDashboard();
    expect(data.children[0].streakAtRisk).toBe(true);
  });
});

// ─── AC-U11c: week vs last ────────────────────────────────────────────────────

describe('this week vs last', () => {
  it('reports a positive delta when the week improved', async () => {
    p.taskAssignment.count
      .mockResolvedValueOnce(0)   // todaysTasks
      .mockResolvedValueOnce(0)   // completedToday
      .mockResolvedValueOnce(0)   // pendingApproval
      .mockResolvedValueOnce(12)  // approved this week
      .mockResolvedValueOnce(4);  // approved last week

    const data = await callDashboard();

    expect(data.weeklyStats.tasksCompletedPrevious).toBe(4);
    expect(data.weeklyStats.tasksCompletedDelta).toBe(8);
  });

  it('reports a negative delta when it got worse — the dashboard must be able to say so', async () => {
    p.taskAssignment.count
      .mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0)
      .mockResolvedValueOnce(3).mockResolvedValueOnce(9);

    const data = await callDashboard();
    expect(data.weeklyStats.tasksCompletedDelta).toBe(-6);
  });

  it('is NULL, not 0, for a family with no history either week', async () => {
    // "No change" and "nothing has ever happened" read differently to a parent.
    primeCounts(0, 0);
    const data = await callDashboard();
    expect(data.weeklyStats.tasksCompletedDelta).toBeNull();
  });

  it('reports a real 0 when both weeks had the same non-zero activity', async () => {
    p.taskAssignment.count
      .mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0)
      .mockResolvedValueOnce(5).mockResolvedValueOnce(5);

    const data = await callDashboard();
    expect(data.weeklyStats.tasksCompletedDelta).toBe(0);
  });
});
