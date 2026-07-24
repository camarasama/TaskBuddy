import request from 'supertest';

/**
 * FR-14 — reward wishlist. A child stars rewards; parents see the counts. Pins the toggle's
 * idempotency, family scoping, and that only children have a wishlist.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    reward: { findFirst: jest.fn() },
    rewardWishlist: { upsert: jest.fn(), deleteMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));

// authenticate/familyIsolation read a verified JWT; stub them to inject a chosen user + family.
let CURRENT: { userId: string; role: string; familyId: string } = {
  userId: 'kid1', role: 'child', familyId: 'fam1',
};
jest.mock('../src/middleware/auth', () => {
  const actual = jest.requireActual('../src/middleware/auth');
  return {
    ...actual,
    authenticate: (req: any, _res: any, next: any) => { req.user = { ...CURRENT }; next(); },
    familyIsolation: (req: any, _res: any, next: any) => { req.familyId = CURRENT.familyId; next(); },
  };
});

import { app } from '../src/index';
import { prisma } from '../src/services/database';

const findReward = prisma.reward.findFirst as jest.Mock;
const upsert = prisma.rewardWishlist.upsert as jest.Mock;
const deleteMany = prisma.rewardWishlist.deleteMany as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  CURRENT = { userId: 'kid1', role: 'child', familyId: 'fam1' };
  upsert.mockResolvedValue({});
  deleteMany.mockResolvedValue({ count: 1 });
});

describe('PUT /rewards/:id/wishlist', () => {
  it('adds a family reward to the child wishlist and is idempotent (upsert)', async () => {
    findReward.mockResolvedValue({ id: 'r1', familyId: 'fam1' });

    const res = await request(app).put('/api/v1/rewards/r1/wishlist');

    expect(res.status).toBe(200);
    expect(res.body.data.wishlisted).toBe(true);
    // upsert with update:{} → calling twice cannot create a duplicate (unique rewardId+childId).
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: {}, create: { rewardId: 'r1', childId: 'kid1' } }),
    );
  });

  it('refuses a reward from another family (scoped lookup finds nothing)', async () => {
    findReward.mockResolvedValue(null);
    const res = await request(app).put('/api/v1/rewards/r1/wishlist');
    expect(res.status).toBe(404);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a non-child (parents do not have a wishlist)', async () => {
    CURRENT = { userId: 'par1', role: 'parent', familyId: 'fam1' };
    const res = await request(app).put('/api/v1/rewards/r1/wishlist');
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('DELETE /rewards/:id/wishlist', () => {
  it('removes it and is idempotent (deleteMany, no error if absent)', async () => {
    const res = await request(app).delete('/api/v1/rewards/r1/wishlist');
    expect(res.status).toBe(200);
    expect(res.body.data.wishlisted).toBe(false);
    expect(deleteMany).toHaveBeenCalledWith({ where: { rewardId: 'r1', childId: 'kid1' } });
  });

  it('refuses a non-child', async () => {
    CURRENT = { userId: 'par1', role: 'parent', familyId: 'fam1' };
    const res = await request(app).delete('/api/v1/rewards/r1/wishlist');
    expect(res.status).toBe(403);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
