import request from 'supertest';

/**
 * FR-11 — task comment thread. The security property that matters most: a child can only see and
 * post on THEIR OWN assignment's thread, never a sibling's, and no one can touch another family's.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    taskAssignment: { findFirst: jest.fn() },
    taskComment: { findMany: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

let CURRENT: { userId: string; role: string; familyId: string };
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => { req.user = { ...CURRENT }; next(); },
    familyIsolation: (req: any, _res: any, next: any) => { req.familyId = CURRENT.familyId; next(); },
  };
});
jest.mock('../src/services/SocketService', () => ({ emitTaskComment: jest.fn() }));
// Keep the real notifications router (index.ts mounts it); only stub the createNotification helper.
jest.mock('../src/routes/notifications', () => ({
  ...jest.requireActual('../src/routes/notifications'),
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

import { app } from '../src/index';
import { prisma } from '../src/services/database';
import { emitTaskComment } from '../src/services/SocketService';

const findAssignment = prisma.taskAssignment.findFirst as jest.Mock;
const findComments = prisma.taskComment.findMany as jest.Mock;
const createComment = prisma.taskComment.create as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  CURRENT = { userId: 'par1', role: 'parent', familyId: 'fam1' };
  findComments.mockResolvedValue([]);
});

const assignmentOwnedBy = (childId: string) => ({
  id: 'a1', childId, task: { familyId: 'fam1' },
});

describe('GET /tasks/assignments/:id/comments', () => {
  it('returns the thread for a family parent', async () => {
    findAssignment.mockResolvedValue(assignmentOwnedBy('kidA'));
    const res = await request(app).get('/api/v1/tasks/assignments/a1/comments');
    expect(res.status).toBe(200);
    expect(res.body.data.comments).toEqual([]);
  });

  it('returns the thread for the child who owns the assignment', async () => {
    CURRENT = { userId: 'kidA', role: 'child', familyId: 'fam1' };
    findAssignment.mockResolvedValue(assignmentOwnedBy('kidA'));
    const res = await request(app).get('/api/v1/tasks/assignments/a1/comments');
    expect(res.status).toBe(200);
  });

  it("FORBIDS a child from reading a sibling's thread", async () => {
    CURRENT = { userId: 'kidB', role: 'child', familyId: 'fam1' };
    findAssignment.mockResolvedValue(assignmentOwnedBy('kidA')); // belongs to kidA, not kidB
    const res = await request(app).get('/api/v1/tasks/assignments/a1/comments');
    expect(res.status).toBe(403);
  });

  it('404s for an assignment outside the caller family (scoped query finds nothing)', async () => {
    findAssignment.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/tasks/assignments/a1/comments');
    expect(res.status).toBe(404);
  });
});

describe('POST /tasks/assignments/:id/comments', () => {
  it('creates a comment, stamps the author, and broadcasts task:comment', async () => {
    findAssignment.mockResolvedValue(assignmentOwnedBy('kidA'));
    createComment.mockResolvedValue({
      id: 'c1', assignmentId: 'a1', authorId: 'par1', content: 'Nice work!',
      createdAt: new Date('2026-07-24T10:00:00Z'),
      author: { id: 'par1', firstName: 'Pat', lastName: 'Parent', role: 'parent' },
    });

    const res = await request(app)
      .post('/api/v1/tasks/assignments/a1/comments')
      .send({ content: 'Nice work!' });

    expect(res.status).toBe(201);
    expect(createComment.mock.calls[0][0].data.authorId).toBe('par1'); // author from the token
    expect(emitTaskComment).toHaveBeenCalledWith(
      'fam1',
      expect.objectContaining({ assignmentId: 'a1' }),
    );
  });

  it('rejects an empty comment (validation)', async () => {
    findAssignment.mockResolvedValue(assignmentOwnedBy('kidA'));
    const res = await request(app)
      .post('/api/v1/tasks/assignments/a1/comments')
      .send({ content: '   ' });
    expect(res.status).toBe(400);
    expect(createComment).not.toHaveBeenCalled();
  });

  it("FORBIDS a child posting on a sibling's assignment", async () => {
    CURRENT = { userId: 'kidB', role: 'child', familyId: 'fam1' };
    findAssignment.mockResolvedValue(assignmentOwnedBy('kidA'));
    const res = await request(app)
      .post('/api/v1/tasks/assignments/a1/comments')
      .send({ content: 'hi' });
    expect(res.status).toBe(403);
    expect(createComment).not.toHaveBeenCalled();
  });
});
