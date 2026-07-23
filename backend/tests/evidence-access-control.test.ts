import jwt from 'jsonwebtoken';
import request from 'supertest';

jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findUnique: jest.fn().mockResolvedValue({ isSuspended: false }) },
    task: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

import { app } from '../src/index';
import { prisma } from '../src/services/database';
import { jwtSignOptions } from '../src/utils/jwt';

const SECRET = process.env.JWT_SECRET as string;
const taskFindFirst = prisma.task.findFirst as jest.Mock;

// Child token for family B. Child role skips the parent email-verification gate in familyIsolation.
function tokenForFamily(familyId: string): string {
  return jwt.sign(
    { userId: `u-${familyId}`, familyId, role: 'child' },
    SECRET,
    { ...jwtSignOptions, expiresIn: '1h' },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.family.findUnique as jest.Mock).mockResolvedValue({ isSuspended: false });
});

describe('evidence access control — cross-family isolation (F-4)', () => {
  it("a family-B user cannot read family-A's task detail and gets no evidence URLs", async () => {
    // The route filters by req.familyId, so another family's task simply is not found.
    taskFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/v1/tasks/task-owned-by-family-A')
      .set('Authorization', `Bearer ${tokenForFamily('famB')}`);

    expect(res.status).toBe(404);
    // The query was scoped to the caller's family, not the requested resource's family.
    expect(taskFindFirst.mock.calls[0][0].where.familyId).toBe('famB');
    // Nothing evidence-shaped leaked in the body.
    expect(JSON.stringify(res.body)).not.toMatch(/fileUrl|fileKey|thumbnail/i);
  });

  it('a user reading their own family task receives the evidence with presigned/stored URLs', async () => {
    taskFindFirst.mockResolvedValue({
      id: 't1',
      familyId: 'famB',
      assignments: [
        {
          id: 'a1',
          evidence: [
            {
              id: 'e1',
              evidenceType: 'photo',
              fileKey: 'evidence/2026-07-22/x.jpg',
              thumbnailKey: 'evidence/2026-07-22/x_thumb.jpg',
              fileUrl: 'http://localhost/uploads/evidence/2026-07-22/x.jpg',
              thumbnailUrl: 'http://localhost/uploads/evidence/2026-07-22/x_thumb.jpg',
            },
          ],
        },
      ],
    });

    const res = await request(app)
      .get('/api/v1/tasks/t1')
      .set('Authorization', `Bearer ${tokenForFamily('famB')}`);

    expect(res.status).toBe(200);
    const evidence = res.body.data.task.assignments[0].evidence[0];
    expect(evidence.fileUrl).toBeTruthy();
  });
});
