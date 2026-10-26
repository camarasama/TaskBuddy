/**
 * PUT /families/me/settings must persist the email switches.
 *
 * Until 2026-10-26 the request schema had no `notificationPreferences` field, so zod stripped it and
 * every switch a parent turned off on the web was thrown away; the emails kept coming. The new
 * "Tips and reminders" switch rides on the same path, which is how this was found.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findUnique: jest.fn().mockResolvedValue({ isSuspended: false, deletedAt: null }) },
    user: { findUnique: jest.fn().mockResolvedValue({ emailVerifiedAt: new Date() }) },
    familySettings: { findUnique: jest.fn(), upsert: jest.fn() },
  },
}));

import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { prisma } from '../src/services/database';
import { familyRouter } from '../src/routes/family';
import { errorHandler } from '../src/middleware/errorHandler';
import { jwtSignOptions } from '../src/utils/jwt';

const app = express();
app.use(express.json());
app.use('/families', familyRouter);
app.use(errorHandler);

const token = jwt.sign(
  { userId: 'p1', familyId: 'f1', role: 'parent' },
  process.env.JWT_SECRET as string,
  { ...jwtSignOptions, expiresIn: '1h' },
);
const findSettings = prisma.familySettings.findUnique as jest.Mock;
const upsert = prisma.familySettings.upsert as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  upsert.mockResolvedValue({});
});

it('merges the switches into what is stored instead of dropping them', async () => {
  findSettings.mockResolvedValue({ notificationPreferences: { task_approved: true, level_up: true } });
  const res = await request(app)
    .put('/families/me/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({ notificationPreferences: { level_up: false, reengagement: false } });
  expect(res.status).toBe(200);
  expect(upsert.mock.calls[0][0].update.notificationPreferences).toEqual({
    task_approved: true,
    level_up: false,
    reengagement: false,
  });
});

it('rejects an unknown email type', async () => {
  const res = await request(app)
    .put('/families/me/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({ notificationPreferences: { password_reset: false } });
  expect(res.status).toBe(400);
  expect(upsert).not.toHaveBeenCalled();
});

it('leaves the stored switches alone when none are sent', async () => {
  const res = await request(app)
    .put('/families/me/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({ enableLeaderboard: true });
  expect(res.status).toBe(200);
  expect(findSettings).not.toHaveBeenCalled();
  expect(upsert.mock.calls[0][0].update).toEqual({ enableLeaderboard: true });
});
