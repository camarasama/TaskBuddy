/**
 * routes/templates.ts — the task template library and reward presets.
 * Mounted at /api/v1/templates. Parent-only: this is a setup surface, not a child one.
 *
 *   GET  /templates/packs              - pack summaries for the browse screen
 *   GET  /templates/tasks              - templates (system + this family's), optionally age-filtered
 *   GET  /templates/tasks/:id          - one template, for pre-filling the create form
 *   POST /templates/packs/:category    - add a whole pack (atomic)
 *   GET  /templates/rewards            - reward presets
 *
 * Growth roadmap §3.1: cold-start is the biggest activation drop-off, because a blank task list
 * demands creative effort from a parent at the moment they have least patience.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireParent, familyIsolation } from '../middleware/auth';
import { validateQuery, validateBody } from '../middleware/validate';
import { TemplateService } from '../services/TemplateService';
import { REWARD_PRESETS } from './templatesSeed';

export const templatesRouter = Router();

templatesRouter.use(authenticate, familyIsolation, requireParent);

const listQuerySchema = z.object({
  category: z.string().max(100).optional(),
  /** Filters to what suits this child's real date of birth. */
  childId: z.string().uuid().optional(),
});

const applyPackSchema = z.object({
  childId: z.string().uuid().optional(),
});

// ─── GET /templates/packs ─────────────────────────────────────────────────────

templatesRouter.get('/packs', async (req, res, next) => {
  try {
    const packs = await TemplateService.listPacks(req.familyId!);
    res.json({ success: true, data: { packs } });
  } catch (error) {
    next(error);
  }
});

// ─── GET /templates/tasks ─────────────────────────────────────────────────────

templatesRouter.get('/tasks', validateQuery(listQuerySchema), async (req, res, next) => {
  try {
    const { category, childId } = listQuerySchema.parse(req.query);
    const templates = await TemplateService.listTemplates({
      familyId: req.familyId!,
      category,
      childId,
    });
    res.json({ success: true, data: { templates } });
  } catch (error) {
    next(error);
  }
});

// ─── GET /templates/tasks/:id ─────────────────────────────────────────────────

templatesRouter.get('/tasks/:id', async (req, res, next) => {
  try {
    const template = await TemplateService.getTemplate(req.familyId!, req.params.id);
    res.json({ success: true, data: { template } });
  } catch (error) {
    next(error);
  }
});

// ─── POST /templates/packs/:category ──────────────────────────────────────────

/**
 * Adds every template in the pack to the family's library, then assigns as many as the child's
 * remaining CR-10 capacity allows. The response says how many were held back and why, so the UI
 * never has to guess or silently drop them.
 */
templatesRouter.post(
  '/packs/:category',
  validateBody(applyPackSchema),
  async (req, res, next) => {
    try {
      const { childId } = applyPackSchema.parse(req.body ?? {});
      const result = await TemplateService.applyPack({
        familyId: req.familyId!,
        createdBy: req.user!.userId,
        category: decodeURIComponent(req.params.category),
        childId,
      });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

// ─── GET /templates/rewards ───────────────────────────────────────────────────

/**
 * Static starter content, copied into a family's own Reward when picked. Deliberately not a table:
 * there is no per-family reward-template authoring in scope, so ten fixed rows would be a migration
 * without a benefit.
 */
templatesRouter.get('/rewards', async (_req, res, next) => {
  try {
    res.json({ success: true, data: { presets: REWARD_PRESETS } });
  } catch (error) {
    next(error);
  }
});
