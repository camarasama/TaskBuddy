/**
 * routes/streakShields.ts — buying streak insurance (growth roadmap §11.4).
 * Mounted at /api/v1/streak-shields. CHILD-ONLY: this is the child's own points sink.
 *
 *   GET  /streak-shields      - how many are banked, the cap, the price, and whether they can buy
 *   POST /streak-shields/buy  - spend points (atomic, through the points ledger)
 *
 * Earning a shield (one per 7-day streak) is unchanged and happens in `streakService`. This is only
 * the second route to the same bank.
 *
 * Everything costs in-app points earned from tasks. There is no real-money path here, and there must
 * never be one — binding under the ethics guardrails for a children's product.
 */

import { Router } from 'express';

import { authenticate, familyIsolation, requireChild } from '../middleware/auth';
import * as StreakShieldService from '../services/StreakShieldService';

export const streakShieldsRouter = Router();

streakShieldsRouter.use(authenticate, familyIsolation, requireChild);

streakShieldsRouter.get('/', async (req, res, next) => {
  try {
    res.json({ success: true, data: await StreakShieldService.status(req.user!.userId) });
  } catch (error) {
    next(error);
  }
});

streakShieldsRouter.post('/buy', async (req, res, next) => {
  try {
    const result = await StreakShieldService.purchase(req.user!.userId);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});
