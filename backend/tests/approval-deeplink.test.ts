/**
 * U5 — the one-tap approval deep link (growth roadmap §3.4).
 *
 * `GET /tasks/assignments/:id` exists so an email or push can land a parent on a single decision.
 * Two properties matter, and both are about what happens when things are NOT in the happy state:
 *
 *  AC-U5c  An already-resolved assignment must return 200 with `resolvedByName`, not 404. Two
 *          co-parents get the same push and both tap it; the second must see "already approved by
 *          Sam", which is a finished state, rather than an error that reads like a bug.
 *  F-4     Evidence is private on R2, so the stored fileUrl is empty until presigned. Skipping that
 *          renders a broken photo on the one screen whose entire job is showing the photo.
 */

const mockWithEvidenceUrlsList = jest.fn();

jest.mock('../src/services/storage', () => ({
  withEvidenceUrlsList: (list: unknown[]) => mockWithEvidenceUrlsList(list),
  withEvidenceUrls: jest.fn(),
  uploadFile: jest.fn(),
}));

jest.mock('../src/services/database', () => ({
  prisma: {
    taskAssignment: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
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
  taskAssignment: { findFirst: jest.Mock };
  user: { findUnique: jest.Mock };
};

/** Invoke GET /assignments/:id directly, without standing up HTTP. */
async function getAssignment(id = 'assign-1') {
  const layer = (taskRouter as unknown as {
    stack: Array<{
      route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> };
    }>;
  }).stack.find((l) => l.route?.path === '/assignments/:id' && l.route.methods.get);

  if (!layer) throw new Error('GET /assignments/:id is not registered');

  const handlers = layer.route!.stack.map((s) => s.handle) as Array<
    (req: unknown, res: unknown, next: (e?: unknown) => void) => Promise<void>
  >;
  const handler = handlers[handlers.length - 1];

  const json = jest.fn();
  const req = { params: { id }, familyId: 'fam-1', user: { userId: 'parent-1', role: 'parent' } };
  let caught: unknown;
  await handler(req, { json }, (e?: unknown) => { caught = e; });

  return { body: json.mock.calls[0]?.[0], error: caught };
}

const baseAssignment = {
  id: 'assign-1',
  status: 'completed',
  approvedBy: null as string | null,
  task: { id: 'task-1', title: 'Tidy room', pointsValue: 10 },
  child: { id: 'child-1', firstName: 'Emma', lastName: 'C' },
  evidence: [{ id: 'ev-1', evidenceType: 'photo', fileKey: 'k/1.jpg', fileUrl: '' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockWithEvidenceUrlsList.mockImplementation((list: Array<Record<string, unknown>>) =>
    Promise.resolve(list.map((e) => ({ ...e, fileUrl: 'https://signed/x', thumbnailUrl: 'https://signed/t' }))),
  );
});

describe('GET /tasks/assignments/:id', () => {
  it('is registered — the email CTA depends on this route existing', async () => {
    p.taskAssignment.findFirst.mockResolvedValue(baseAssignment);
    const { error } = await getAssignment();
    expect(error).toBeUndefined();
  });

  it('returns a pending assignment as pending', async () => {
    p.taskAssignment.findFirst.mockResolvedValue(baseAssignment);
    const { body } = await getAssignment();
    expect(body.data.isPending).toBe(true);
    expect(body.data.resolvedByName).toBeNull();
  });

  it('presigns the evidence — F-4 made it private, so the raw fileUrl is empty', async () => {
    p.taskAssignment.findFirst.mockResolvedValue({ ...baseAssignment });
    const { body } = await getAssignment();
    expect(mockWithEvidenceUrlsList).toHaveBeenCalled();
    expect(body.data.assignment.evidence[0].fileUrl).toBe('https://signed/x');
  });

  it('scopes the lookup to the caller’s family', async () => {
    p.taskAssignment.findFirst.mockResolvedValue(baseAssignment);
    await getAssignment();
    const where = p.taskAssignment.findFirst.mock.calls[0][0].where;
    expect(where.task.familyId).toBe('fam-1');
  });

  // AC-U5c — the co-parent race.
  it('returns an ALREADY-APPROVED assignment with the resolver’s name, not a 404', async () => {
    p.taskAssignment.findFirst.mockResolvedValue({
      ...baseAssignment,
      status: 'approved',
      approvedBy: 'parent-2',
    });
    p.user.findUnique.mockResolvedValue({ firstName: 'Sam', lastName: 'Okafor' });

    const { body, error } = await getAssignment();

    expect(error).toBeUndefined();
    expect(body.data.isPending).toBe(false);
    expect(body.data.resolvedByName).toBe('Sam Okafor');
  });

  it('handles a rejected assignment the same way', async () => {
    p.taskAssignment.findFirst.mockResolvedValue({
      ...baseAssignment,
      status: 'rejected',
      approvedBy: 'parent-2',
    });
    p.user.findUnique.mockResolvedValue({ firstName: 'Sam', lastName: 'Okafor' });

    const { body } = await getAssignment();
    expect(body.data.isPending).toBe(false);
  });

  it('still resolves when the approving parent has since been removed', async () => {
    // A deleted co-parent must not turn a finished state into a crash.
    p.taskAssignment.findFirst.mockResolvedValue({
      ...baseAssignment,
      status: 'approved',
      approvedBy: 'gone',
    });
    p.user.findUnique.mockResolvedValue(null);

    const { body, error } = await getAssignment();
    expect(error).toBeUndefined();
    expect(body.data.resolvedByName).toBeNull();
  });

  it('404s for an assignment outside the family', async () => {
    p.taskAssignment.findFirst.mockResolvedValue(null);
    const { error } = await getAssignment();
    expect((error as Error)?.message).toMatch(/not found/i);
  });
});
