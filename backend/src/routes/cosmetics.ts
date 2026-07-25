/**
 * routes/cosmetics.ts — avatar cosmetics (growth roadmap §4.4).
 * Mounted at /api/v1/cosmetics. CHILD-ONLY: this is the child's own points sink.
 *
 *   GET    /cosmetics            - catalogue annotated with owned / equipped / affordable
 *   POST   /cosmetics/:id/buy    - spend points (atomic, through the points ledger)
 *   PUT    /cosmetics/:id/equip  - wear an owned item
 *   DELETE /cosmetics/:id/equip  - take it off; ownership is untouched
 *
 * Everything costs in-app points earned from tasks. There is no real-money path here, and there
 * must never be one — binding under the ethics guardrails for a children's product.
 */

import { Router } from 'express';
import { authenticate, requireChild, familyIsolation } from '../middleware/auth';
import { CosmeticService } from '../services/CosmeticService';

export const cosmeticsRouter = Router();

cosmeticsRouter.use(authenticate, familyIsolation, requireChild);

cosmeticsRouter.get('/', async (req, res, next) => {
  try {
    const data = await CosmeticService.listForChild(req.user!.userId);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

cosmeticsRouter.post('/:id/buy', async (req, res, next) => {
  try {
    const result = await CosmeticService.purchase({
      childId: req.user!.userId,
      itemId: req.params.id,
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

cosmeticsRouter.put('/:id/equip', async (req, res, next) => {
  try {
    await CosmeticService.equip({ childId: req.user!.userId, itemId: req.params.id });
    res.json({ success: true, data: { equipped: true } });
  } catch (error) {
    next(error);
  }
});

cosmeticsRouter.delete('/:id/equip', async (req, res, next) => {
  try {
    await CosmeticService.unequip({ childId: req.user!.userId, itemId: req.params.id });
    res.json({ success: true, data: { equipped: false } });
  } catch (error) {
    next(error);
  }
});
