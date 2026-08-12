/**
 * `GET /tasks?view=open|done` filters on what a task's ASSIGNMENTS are doing.
 *
 * The parent app needs an Active/Completed split, and `TaskStatus` cannot express it: the enum is
 * only active/paused/archived, and "has anyone finished this?" lives one table down on
 * TaskAssignment. Deriving it on the client is wrong the moment a family has more than one page,
 * because a filter applied after paging both drops rows and makes `pagination.total` a lie.
 *
 * These tests pin the WHERE clause rather than the returned rows, the same choice as
 * `pagination-stable-order.test.ts`: the clause is the contract with Prisma, and it is where the two
 * subtle judgements live (a rejected task is open, an all-expired task is unassigned).
 */

const mockWithEvidenceUrlsList = jest.fn();

jest.mock('../src/services/storage', () => ({
  withEvidenceUrlsList: (list: unknown[]) => mockWithEvidenceUrlsList(list),
  withEvidenceUrls: jest.fn(),
  uploadFile: jest.fn(),
}));

jest.mock('../src/services/database', () => ({
  prisma: {
    task: { findMany: jest.fn(), count: jest.fn() },
    taskAssignment: { findMany: jest.fn(), count: jest.fn() },
  },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (_q: unknown, _s: unknown, n: () => void) => n(),
  familyIsolation: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireParent: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireChild: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireAuth: (_q: unknown, _s: unknown, n: () => void) => n(),
}));

import { taskRouter } from '../src/routes/tasks';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  task: { findMany: jest.Mock; count: jest.Mock };
  taskAssignment: { count: jest.Mock };
};

/** Invoke GET /tasks directly, skipping the validation middleware, without standing up HTTP. */
async function listTasks(query: Record<string, string>, role: 'parent' | 'child' = 'parent') {
  const layer = (taskRouter as unknown as {
    stack: Array<{
      route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
    }>;
  }).stack.find((l) => l.route?.path === '/' && l.route.methods.get);

  if (!layer) throw new Error('GET /tasks is not registered');

  const handlers = layer.route!.stack.map((s) => s.handle) as Array<
    (req: unknown, res: unknown, next: (e?: unknown) => void) => Promise<void>
  >;
  const handler = handlers[handlers.length - 1];

  const json = jest.fn();
  const req = {
    query,
    familyId: 'fam-1',
    user: { userId: role === 'child' ? 'child-1' : 'parent-1', role },
  };
  let caught: unknown;
  await handler(req, { json, status: () => ({ json }) }, (e?: unknown) => { caught = e; });

  return { body: json.mock.calls[0]?.[0], error: caught };
}

/** The `where` the list query actually ran with. */
function whereFromFindMany(): Record<string, any> {
  return p.task.findMany.mock.calls[0][0].where;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWithEvidenceUrlsList.mockImplementation((list: unknown[]) => Promise.resolve(list));
  p.task.findMany.mockResolvedValue([]);
  p.task.count.mockResolvedValue(0);
  p.taskAssignment.count.mockResolvedValue(0);
});

describe('GET /tasks?view=open', () => {
  it('matches a task nobody currently owes, or one with outstanding work', async () => {
    const { error } = await listTasks({ view: 'open' });
    expect(error).toBeUndefined();

    expect(whereFromFindMany().AND).toEqual([
      {
        OR: [
          { assignments: { none: { status: { not: 'expired' } } } },
          { assignments: { some: { status: { in: ['pending', 'in_progress', 'rejected'] } } } },
        ],
      },
    ]);
  });

  it('counts a REJECTED task as open, because it is back in the child\'s court', async () => {
    await listTasks({ view: 'open' });
    const clause = whereFromFindMany().AND[0].OR[1];
    expect(clause.assignments.some.status.in).toContain('rejected');
  });

  it('treats an all-expired task as unassigned rather than finished', async () => {
    // An expired assignment means the child missed it. The task is still claimable, and
    // `canSelfAssign` already ignores expired rows, so filing it under done would hide it.
    await listTasks({ view: 'open' });
    const clause = whereFromFindMany().AND[0].OR[0];
    expect(clause).toEqual({ assignments: { none: { status: { not: 'expired' } } } });
  });
});

describe('GET /tasks?view=done', () => {
  it('matches a task somebody has finished, approved or not yet', async () => {
    const { error } = await listTasks({ view: 'done' });
    expect(error).toBeUndefined();

    expect(whereFromFindMany().AND).toEqual([
      { assignments: { some: { status: { in: ['completed', 'approved'] } } } },
    ]);
  });

  it('does not count a rejected or expired task as done', async () => {
    await listTasks({ view: 'done' });
    const statuses = whereFromFindMany().AND[0].assignments.some.status.in;
    expect(statuses).not.toContain('rejected');
    expect(statuses).not.toContain('expired');
    expect(statuses).not.toContain('pending');
  });
});

describe('the two views deliberately overlap', () => {
  it('neither clause excludes the other, so a recurring task can be on both tabs', async () => {
    // A daily task whose instance for today is approved while tomorrow's is already pending is
    // genuinely both finished and outstanding. Picking one tab would be wrong for half the day.
    // Guarded structurally: a `NOT` in either clause would make them mutually exclusive.
    await listTasks({ view: 'open' });
    const open = JSON.stringify(whereFromFindMany().AND);
    jest.clearAllMocks();
    p.task.findMany.mockResolvedValue([]);
    p.task.count.mockResolvedValue(0);
    await listTasks({ view: 'done' });
    const done = JSON.stringify(whereFromFindMany().AND);

    expect(open).not.toContain('"NOT"');
    expect(done).not.toContain('"NOT"');
  });
});

describe('composition with the rest of the query', () => {
  it('counts over the SAME where, so pagination.total is not a lie', async () => {
    await listTasks({ view: 'done' });
    expect(p.task.count.mock.calls[0][0].where).toEqual(whereFromFindMany());
  });

  it('combines with a status filter instead of replacing it', async () => {
    await listTasks({ status: 'active', view: 'done' });
    const where = whereFromFindMany();
    expect(where.status).toBe('active');
    expect(where.AND).toHaveLength(1);
  });

  it('does not clobber the child branch, which owns OR', async () => {
    // The child role assigns `where.OR` for the self-assign pool. Assigning view to OR as well
    // would silently drop one of the two.
    const { error } = await listTasks({ view: 'open' }, 'child');
    expect(error).toBeUndefined();

    const where = whereFromFindMany();
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR.length).toBeGreaterThan(1);
    expect(where.AND).toHaveLength(1);
  });

  it('is absent from the query when no view is asked for', async () => {
    await listTasks({});
    expect(whereFromFindMany().AND).toBeUndefined();
  });
});
