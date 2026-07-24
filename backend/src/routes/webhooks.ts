import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { MAX_WEBHOOKS_PER_FAMILY, WEBHOOK_EVENTS } from '@taskbuddy/shared';
import { prisma } from '../services/database';
import { WebhookService } from '../services/WebhookService';
import { AuditService } from '../services/AuditService';
import { authenticate, requireParent, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler';
import { UnsafeUrlError } from '../utils/ssrf';

/**
 * FR-18 — webhook management. Parents only, family-scoped.
 *
 * The signing secret is write-once: it is generated server-side, returned by POST exactly once, and
 * stored encrypted (same AES-256-GCM helper as the admin TOTP secret). There is deliberately no way
 * to read it back — a leaked secret is a forgery capability, so recovery is "delete and recreate",
 * not "show it to me again".
 */

export const webhookRouter = Router();

webhookRouter.use(authenticate, familyIsolation, requireParent);

/** Test pings are an outbound request the caller controls; cap them well below anything abusable. */
const testLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as { user?: { userId?: string } }).user?.userId ?? 'anonymous',
  message: {
    success: false,
    error: { message: 'Too many webhook tests. Please wait a while before trying again.' },
  },
});

/** Everything the parent may read back. `secret` is absent on purpose. */
const PUBLIC_FIELDS = {
  id: true,
  familyId: true,
  url: true,
  events: true,
  description: true,
  isActive: true,
  lastDeliveryAt: true,
  lastStatus: true,
  lastError: true,
  consecutiveFailures: true,
  disabledAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const eventsSchema = z
  .array(z.enum(WEBHOOK_EVENTS))
  .min(1, 'Choose at least one event')
  .refine((events) => new Set(events).size === events.length, 'Duplicate events');

const createSchema = z.object({
  url: z.string().min(1).max(2000),
  events: eventsSchema,
  description: z.string().max(120).optional(),
});

// `validateBody` takes a plain object schema, so the "at least one field" check lives in the
// handler rather than in a `.refine()` wrapper.
const updateSchema = z.object({
  url: z.string().min(1).max(2000).optional(),
  events: eventsSchema.optional(),
  description: z.string().max(120).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** Turns the SSRF guard's rejection into a 400 the parent can act on. */
function assertUrl(url: string): void {
  try {
    WebhookService.assertSafeUrl(url);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new ValidationError(err.message);
    throw err;
  }
}

// GET /webhooks - list this family's webhooks
webhookRouter.get('/', async (req, res, next) => {
  try {
    const webhooks = await prisma.webhookSubscription.findMany({
      where: { familyId: req.familyId },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: { webhooks } });
  } catch (error) {
    next(error);
  }
});

// POST /webhooks - register a webhook. Returns the signing secret ONCE.
webhookRouter.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    assertUrl(req.body.url);

    const existing = await prisma.webhookSubscription.count({ where: { familyId: req.familyId } });
    if (existing >= MAX_WEBHOOKS_PER_FAMILY) {
      throw new ConflictError(`A family can have at most ${MAX_WEBHOOKS_PER_FAMILY} webhooks.`);
    }

    const secret = WebhookService.generateSecret();
    const webhook = await prisma.webhookSubscription.create({
      data: {
        familyId: req.familyId!,
        url: req.body.url,
        events: req.body.events,
        description: req.body.description ?? null,
        secret: WebhookService.encryptSecret(secret),
        createdBy: req.user!.userId,
      },
      select: PUBLIC_FIELDS,
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'webhook_subscription',
      resourceId: webhook.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { url: webhook.url, events: webhook.events },
    });

    // 201 with the plaintext secret — the only response that ever contains it.
    res.status(201).json({ success: true, data: { webhook, secret } });
  } catch (error) {
    next(error);
  }
});

// PATCH /webhooks/:id - change url/events/description, or enable/disable
webhookRouter.patch('/:id', validateBody(updateSchema), async (req, res, next) => {
  try {
    const existing = await prisma.webhookSubscription.findFirst({
      where: { id: req.params.id, familyId: req.familyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError('Webhook not found');

    if (Object.keys(req.body).length === 0) throw new ValidationError('Nothing to update');
    if (req.body.url !== undefined) assertUrl(req.body.url);

    const data: Record<string, unknown> = {};
    if (req.body.url !== undefined) data.url = req.body.url;
    if (req.body.events !== undefined) data.events = req.body.events;
    if (req.body.description !== undefined) data.description = req.body.description;
    if (req.body.isActive !== undefined) {
      data.isActive = req.body.isActive;
      // Re-enabling clears the failure state, otherwise one more failure would trip the auto-disable
      // limit immediately and the parent's fix would look like it did nothing.
      if (req.body.isActive) {
        data.consecutiveFailures = 0;
        data.disabledAt = null;
        data.lastError = null;
      }
    }

    const webhook = await prisma.webhookSubscription.update({
      where: { id: existing.id },
      data,
      select: PUBLIC_FIELDS,
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'webhook_subscription',
      resourceId: webhook.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { changed: Object.keys(data) },
    });

    res.json({ success: true, data: { webhook } });
  } catch (error) {
    next(error);
  }
});

// DELETE /webhooks/:id
webhookRouter.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.webhookSubscription.findFirst({
      where: { id: req.params.id, familyId: req.familyId },
      select: { id: true, url: true },
    });
    if (!existing) throw new NotFoundError('Webhook not found');

    await prisma.webhookSubscription.delete({ where: { id: existing.id } });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'DELETE',
      resourceType: 'webhook_subscription',
      resourceId: existing.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { url: existing.url },
    });

    res.json({ success: true, data: { message: 'Webhook deleted' } });
  } catch (error) {
    next(error);
  }
});

// POST /webhooks/:id/test - send a signed `ping` so the parent can verify their receiver
webhookRouter.post('/:id/test', testLimiter, async (req, res, next) => {
  try {
    const webhook = await prisma.webhookSubscription.findFirst({
      where: { id: req.params.id, familyId: req.familyId },
      select: { id: true, url: true, secret: true },
    });
    if (!webhook) throw new NotFoundError('Webhook not found');

    const result = await WebhookService.deliver(webhook, 'ping', {
      message: 'Test delivery from TaskBuddy',
      familyId: req.familyId,
    });

    res.json({
      success: true,
      data: { delivered: result.delivered, status: result.status, error: result.error },
    });
  } catch (error) {
    next(error);
  }
});
