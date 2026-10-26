/**
 * routes/adminInsights.ts - admin Overview metrics and the re-engagement controls (2026-10-26).
 *
 * Mounted at /api/v1/admin BEFORE adminRouter; anything not matched here falls through to it.
 * Every route requires an admin JWT.
 *
 *   GET   /admin/insights/overview?range=7d|30d|90d|12m&includeTesters=true
 *   GET   /admin/insights/nudges?stage=one_and_done|dormant|at_risk&page=1
 *   GET   /admin/reengagement                         stats + global pause state
 *   PATCH /admin/reengagement/settings                { paused }
 *   POST  /admin/reengagement/test                    { track, step } to the admin's own inbox
 *   POST  /admin/reengagement/families/:id/send-next  next step now
 *   PATCH /admin/reengagement/families/:id/pause      { paused }
 *   PATCH /admin/families/:id/test-account            { isTestAccount }
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { AuditService } from '../services/AuditService';
import { PlatformInsightsService, loadFamilies, RANGES, type RangeKey } from '../services/PlatformInsightsService';
import { ReengagementService } from '../services/ReengagementService';
import { NUDGE_STAGES, stageOf, type Stage } from '../services/lifecycle';

export const adminInsightsRouter = Router();

const auth = [authenticate, requireAdmin];

const boolish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true');

const overviewQuery = z.object({
  range: z.enum(Object.keys(RANGES) as [RangeKey, ...RangeKey[]]).default('30d'),
  includeTesters: boolish.default(false),
});

const nudgeQuery = z.object({
  stage: z.enum(['one_and_done', 'dormant', 'at_risk']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const pausedBody = z.object({ paused: z.boolean() });
const testAccountBody = z.object({ isTestAccount: z.boolean() });
const testSendBody = z.object({
  track: z.enum(['setup', 'lapsed']),
  step: z.number().int().min(1).max(4),
});

// ─── Overview ────────────────────────────────────────────────────────────────

adminInsightsRouter.get('/insights/overview', ...auth, validateQuery(overviewQuery), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof overviewQuery>;
    const data = await PlatformInsightsService.overview({ range: q.range, includeTesters: q.includeTesters });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

// ─── Families that need a nudge ──────────────────────────────────────────────

const STAGE_ORDER: Record<Stage, number> = {
  one_and_done: 0, dormant: 1, at_risk: 2, new: 3, engaged: 4, churned: 5,
};

adminInsightsRouter.get('/insights/nudges', ...auth, validateQuery(nudgeQuery), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof nudgeQuery>;
    const now = new Date();
    const staged = (await loadFamilies())
      .filter((f) => !f.isTest)
      .map((f) => ({ ...f, stage: stageOf(f, now) }))
      .filter((f) => NUDGE_STAGES.includes(f.stage));

    const counts = { all: staged.length, one_and_done: 0, dormant: 0, at_risk: 0 } as Record<string, number>;
    for (const f of staged) counts[f.stage]++;

    const list = staged
      .filter((f) => !q.stage || f.stage === q.stage)
      .sort(
        (a, b) =>
          STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] ||
          (b.lastActiveAt ?? b.createdAt).getTime() - (a.lastActiveAt ?? a.createdAt).getTime(),
      );
    const pageRows = list.slice((q.page - 1) * q.limit, q.page * q.limit);
    const ids = pageRows.map((f) => f.id);

    const [details, plans] = await Promise.all([
      prisma.family.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          familyName: true,
          isSuspended: true,
          reengagementPausedAt: true,
          users: {
            where: { role: 'parent', deletedAt: null, isActive: true, emailVerifiedAt: { not: null }, reengagementOptOutAt: null },
            select: { id: true },
          },
        },
      }),
      ReengagementService.plansFor(ids, now),
    ]);
    const byId = new Map(details.map((d) => [d.id, d]));

    res.json({
      success: true,
      data: {
        counts,
        total: list.length,
        page: q.page,
        limit: q.limit,
        families: pageRows.map((f) => {
          const d = byId.get(f.id);
          const plan = plans.get(f.id) ?? null;
          return {
            id: f.id,
            familyName: d?.familyName ?? '',
            parents: f.parents,
            children: f.children,
            createdAt: f.createdAt,
            lastActiveAt: f.lastActiveAt,
            stage: f.stage,
            paused: !!d?.reengagementPausedAt,
            reachableParents: d?.users.length ?? 0,
            suspended: !!d?.isSuspended,
            plan: plan && {
              track: plan.track,
              sentSteps: plan.sentSteps,
              lastSentAt: plan.lastSentAt,
              nextStep: plan.nextStep,
              nextDueAt: plan.nextDueAt,
            },
          };
        }),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Re-engagement ───────────────────────────────────────────────────────────

adminInsightsRouter.get('/reengagement', ...auth, async (_req, res, next) => {
  try {
    res.json({ success: true, data: await ReengagementService.stats() });
  } catch (error) {
    next(error);
  }
});

adminInsightsRouter.patch('/reengagement/settings', ...auth, validateBody(pausedBody), async (req, res, next) => {
  try {
    await ReengagementService.setGloballyPaused(req.body.paused, req.user!.userId);
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: req.body.paused ? 'SUSPEND' : 'REACTIVATE',
      resourceType: 'reengagement',
      resourceId: 'global',
      ipAddress: req.ip,
      metadata: { paused: req.body.paused },
    });
    res.json({ success: true, data: { paused: req.body.paused } });
  } catch (error) {
    next(error);
  }
});

adminInsightsRouter.post('/reengagement/test', ...auth, validateBody(testSendBody), async (req, res, next) => {
  try {
    const admin = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { email: true, firstName: true },
    });
    if (!admin?.email) throw new AppError(400, 'NO_EMAIL', 'Your admin account has no email address.');
    await ReengagementService.sendTest({ toEmail: admin.email, firstName: admin.firstName, ...req.body });
    res.json({ success: true, data: { sentTo: admin.email } });
  } catch (error) {
    next(error);
  }
});

adminInsightsRouter.post('/reengagement/families/:id/send-next', ...auth, async (req, res, next) => {
  try {
    const family = await prisma.family.findUnique({ where: { id: req.params.id }, select: { id: true, familyName: true } });
    if (!family) throw new NotFoundError('Family not found');
    const outcome = await ReengagementService.sendNextNow(family.id, req.user!.userId);
    if (!outcome.sent) throw new AppError(409, 'NOTHING_SENT', outcome.reason ?? 'Nothing was sent.');
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'reengagement_email',
      resourceId: family.id,
      familyId: family.id,
      ipAddress: req.ip,
      metadata: { track: outcome.track, step: outcome.step, recipients: outcome.recipients },
    });
    res.json({ success: true, data: outcome });
  } catch (error) {
    next(error);
  }
});

adminInsightsRouter.patch('/reengagement/families/:id/pause', ...auth, validateBody(pausedBody), async (req, res, next) => {
  try {
    const family = await prisma.family.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!family) throw new NotFoundError('Family not found');
    await ReengagementService.setFamilyPaused(family.id, req.body.paused);
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'family',
      resourceId: family.id,
      familyId: family.id,
      ipAddress: req.ip,
      metadata: { reengagementPaused: req.body.paused },
    });
    res.json({ success: true, data: { paused: req.body.paused } });
  } catch (error) {
    next(error);
  }
});

adminInsightsRouter.patch('/families/:id/test-account', ...auth, validateBody(testAccountBody), async (req, res, next) => {
  try {
    const family = await prisma.family.findUnique({ where: { id: req.params.id }, select: { id: true, familyName: true } });
    if (!family) throw new NotFoundError('Family not found');
    await prisma.family.update({ where: { id: family.id }, data: { isTestAccount: req.body.isTestAccount } });
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'family',
      resourceId: family.id,
      familyId: family.id,
      ipAddress: req.ip,
      metadata: { isTestAccount: req.body.isTestAccount, familyName: family.familyName },
    });
    res.json({ success: true, data: { isTestAccount: req.body.isTestAccount } });
  } catch (error) {
    next(error);
  }
});
