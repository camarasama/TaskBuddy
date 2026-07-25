/**
 * webhooks.ts — FR-18 parent-facing management of outbound webhook subscriptions.
 *
 * Parents (and admins) only; children are refused by requireParent. Every query is scoped to
 * req.familyId, so a parent in family A can never read, reveal or delete family B's subscription —
 * the id alone is not authority.
 *
 * The signing secret is shown exactly twice: in the create response (so it can be copied straight
 * into n8n/Zapier) and from the explicit reveal endpoint. It is never in the list response.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, requireParent, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { AuditService } from '../services/AuditService';
import {
  WebhookService,
  WebhookUrlError,
  assertSafeWebhookUrl,
  sealWebhookSecret,
  openWebhookSecret,
} from '../services/WebhookService';
import { WEBHOOK_EVENTS } from '@taskbuddy/shared';

export const webhooksRouter = Router();

webhooksRouter.use(authenticate, requireParent, familyIsolation);

/** Cap per family so a compromised parent account cannot turn the server into a fan-out cannon. */
const MAX_SUBSCRIPTIONS_PER_FAMILY = 10;

const createSchema = z.object({
  url: z.string().min(1).max(2048),
  events: z
    .array(z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]]))
    .min(1, 'Choose at least one event')
    .max(WEBHOOK_EVENTS.length),
});

/** Public shape — deliberately without `secret`. */
const PUBLIC_FIELDS = {
  id: true,
  url: true,
  events: true,
  isActive: true,
  failureCount: true,
  lastFailureAt: true,
  lastSuccessAt: true,
  disabledAt: true,
  recentFailures: true,
  createdAt: true,
} as const;

// ─── GET / — list this family's subscriptions (never includes the secret) ────

webhooksRouter.get('/', async (req, res, next) => {
  try {
    const subscriptions = await prisma.webhookSubscription.findMany({
      where: { familyId: req.familyId! },
      select: PUBLIC_FIELDS,
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: { subscriptions, availableEvents: WEBHOOK_EVENTS } });
  } catch (error) {
    next(error);
  }
});

// ─── POST / — register an endpoint ───────────────────────────────────────────

webhooksRouter.post('/', validateBody(createSchema), async (req, res, next) => {
  try {
    const { url, events } = req.body as { url: string; events: string[] };

    // SSRF policy runs BEFORE anything is written: https only, resolves to public unicast only.
    // It is re-run before every delivery too — see WebhookService for why one check is not enough.
    let normalisedUrl: string;
    try {
      normalisedUrl = (await assertSafeWebhookUrl(url)).url.toString();
    } catch (err) {
      if (err instanceof WebhookUrlError) throw new AppError(400, 'INVALID_WEBHOOK_URL', err.message);
      throw err;
    }

    const existing = await prisma.webhookSubscription.count({ where: { familyId: req.familyId! } });
    if (existing >= MAX_SUBSCRIPTIONS_PER_FAMILY) {
      throw new AppError(
        409,
        'WEBHOOK_LIMIT_REACHED',
        `A family can have at most ${MAX_SUBSCRIPTIONS_PER_FAMILY} webhook endpoints.`,
      );
    }

    const secret = WebhookService.generateSecret();
    const subscription = await prisma.webhookSubscription.create({
      data: {
        familyId: req.familyId!,
        url: normalisedUrl,
        events: Array.from(new Set(events)),
        secret: sealWebhookSecret(secret),
      },
      select: PUBLIC_FIELDS,
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'webhook_subscription',
      resourceId: subscription.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { url: normalisedUrl, events: subscription.events },
    });

    // First and only automatic sighting of the plaintext secret.
    res.status(201).json({ success: true, data: { subscription, secret } });
  } catch (error) {
    next(error);
  }
});

// ─── GET /:id/secret — explicit reveal ───────────────────────────────────────

webhooksRouter.get('/:id/secret', async (req, res, next) => {
  try {
    const subscription = await prisma.webhookSubscription.findFirst({
      // familyId in the WHERE, not a post-hoc check: another family's id simply finds nothing.
      where: { id: req.params.id, familyId: req.familyId! },
      select: { id: true, secret: true },
    });
    if (!subscription) throw new NotFoundError('Webhook subscription not found');

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'READ',
      resourceType: 'webhook_secret',
      resourceId: subscription.id,
      familyId: req.familyId,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { secret: openWebhookSecret(subscription.secret) } });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /:id — remove an endpoint ────────────────────────────────────────

webhooksRouter.delete('/:id', async (req, res, next) => {
  try {
    const { count } = await prisma.webhookSubscription.deleteMany({
      where: { id: req.params.id, familyId: req.familyId! },
    });
    if (count === 0) throw new NotFoundError('Webhook subscription not found');

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'DELETE',
      resourceType: 'webhook_subscription',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});
