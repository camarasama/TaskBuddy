/**
 * Offset pagination is only coherent over a TOTAL order.
 *
 * Reported symptom: a child saw the same recurring task twice on their task list. The cause was not
 * duplicate data — `@@unique([taskId, childId, instanceDate])` makes that impossible — but
 * `GET /tasks/assignments/me` ordering by `[status, instanceDate]` and paging with OFFSET/LIMIT.
 * Neither column identifies a row: a daily recurring task yields one `pending` assignment per day,
 * and any two tasks owed on the same day tie on both. SQL leaves tied rows unordered, so each page
 * is an independently ordered query — page 2 can begin above where page 1 ended, repeating a row
 * and dropping another. The client concatenates pages, and the repeat surfaces as a duplicate row.
 *
 * Two tests, deliberately different in kind:
 *
 *  1. A behavioural test on the endpoint that was actually reported.
 *  2. A source guard over every paginated query in the route layer. The defect was systemic — six
 *     queries had it — so pinning only the reported one would let the next one ship.
 */

const mockWithEvidenceUrlsList = jest.fn();

jest.mock('../src/services/storage', () => ({
  withEvidenceUrlsList: (list: unknown[]) => mockWithEvidenceUrlsList(list),
  withEvidenceUrls: jest.fn(),
  uploadFile: jest.fn(),
}));

jest.mock('../src/services/database', () => ({
  prisma: {
    taskAssignment: { findMany: jest.fn(), count: jest.fn() },
    task: { findMany: jest.fn() },
  },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (_q: unknown, _s: unknown, n: () => void) => n(),
  familyIsolation: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireParent: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireChild: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireAuth: (_q: unknown, _s: unknown, n: () => void) => n(),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { taskRouter } from '../src/routes/tasks';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  taskAssignment: { findMany: jest.Mock; count: jest.Mock };
  task: { findMany: jest.Mock };
};

/** Invoke GET /assignments/me directly, without standing up HTTP. */
async function getMyAssignments() {
  const layer = (taskRouter as unknown as {
    stack: Array<{
      route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
    }>;
  }).stack.find((l) => l.route?.path === '/assignments/me' && l.route.methods.get);

  if (!layer) throw new Error('GET /assignments/me is not registered');

  const handlers = layer.route!.stack.map((s) => s.handle) as Array<
    (req: unknown, res: unknown, next: (e?: unknown) => void) => Promise<void>
  >;
  const handler = handlers[handlers.length - 1];

  const json = jest.fn();
  const req = {
    query: { page: '1', limit: '20' },
    familyId: 'fam-1',
    user: { userId: 'child-1', role: 'child' },
  };
  let caught: unknown;
  await handler(req, { json }, (e?: unknown) => { caught = e; });

  return { body: json.mock.calls[0]?.[0], error: caught };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockWithEvidenceUrlsList.mockImplementation((list: unknown[]) => Promise.resolve(list));
  p.taskAssignment.count.mockResolvedValue(0);
  p.taskAssignment.findMany.mockResolvedValue([]);
  p.task.findMany.mockResolvedValue([]);
});

describe('GET /tasks/assignments/me — stable ordering', () => {
  it('ends its orderBy with the unique id, so tied rows cannot straddle two pages', async () => {
    const { error } = await getMyAssignments();
    expect(error).toBeUndefined();

    const orderBy = p.taskAssignment.findMany.mock.calls[0][0].orderBy as Array<
      Record<string, unknown>
    >;

    expect(Array.isArray(orderBy)).toBe(true);
    // The LAST key is what decides ties; an `id` anywhere earlier would not.
    expect(Object.keys(orderBy[orderBy.length - 1])).toEqual(['id']);
  });

  it('still orders by status then instanceDate first, so the tiebreak did not reorder the list', async () => {
    await getMyAssignments();

    const orderBy = p.taskAssignment.findMany.mock.calls[0][0].orderBy as Array<
      Record<string, unknown>
    >;

    expect(orderBy.slice(0, 2)).toEqual([{ status: 'asc' }, { instanceDate: 'desc' }]);
  });
});

/**
 * Extract the argument text of every `findMany(...)` in a source file by matching balanced
 * parentheses — regex alone cannot span these nested object literals.
 */
function findManyCalls(source: string): string[] {
  const calls: string[] = [];
  const marker = 'findMany(';

  for (let i = source.indexOf(marker); i !== -1; i = source.indexOf(marker, i + 1)) {
    let depth = 0;
    for (let j = i + marker.length - 1; j < source.length; j++) {
      if (source[j] === '(') depth++;
      else if (source[j] === ')') {
        depth--;
        if (depth === 0) {
          calls.push(source.slice(i, j + 1));
          break;
        }
      }
    }
  }

  return calls;
}

describe('every paginated route query has a unique tiebreak', () => {
  const ROUTE_FILES = ['achievements.ts', 'notifications.ts', 'rewards.ts', 'tasks.ts'];

  it.each(ROUTE_FILES)('%s', (file) => {
    const source = readFileSync(join(__dirname, '..', 'src', 'routes', file), 'utf8');

    // Only paginated queries are at risk. An unpaginated findMany returns the whole set, so a
    // non-deterministic tie order is a cosmetic wobble rather than a lost or repeated row.
    const paginated = findManyCalls(source).filter(
      (call) => /\bskip\b\s*[,:]/.test(call) && /\btake\b\s*[,:]/.test(call)
    );

    expect(paginated.length).toBeGreaterThan(0);

    for (const call of paginated) {
      // The last `id:` must come after every other ordering key in the orderBy clause.
      const orderBy = call.slice(call.indexOf('orderBy'));
      const lastKey = [...orderBy.matchAll(/\{\s*(\w+):/g)].pop()?.[1];

      expect(lastKey).toBe('id');
    }
  });
});
