import request from 'supertest';

// Mock the Prisma singleton so /health can be exercised without a real database.
jest.mock('../src/services/database', () => ({
  prisma: { $queryRaw: jest.fn() },
}));

import { app } from '../src/index';
import { prisma } from '../src/services/database';

const queryRaw = prisma.$queryRaw as jest.Mock;

describe('GET /health (readiness)', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 200 and db:up when the database is reachable', async () => {
    queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns 503 and db:down when the database is unreachable', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app).get('/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'down' });
  });
});
