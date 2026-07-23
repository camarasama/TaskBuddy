/**
 * notifications.ts - M10 Phase 4/5 (performance fix)
 *
 * Performance fixes applied:
 *  1. Use shared `prisma` singleton from ../services/database (not `new PrismaClient()`)
 *  2. Static import of emitNotificationNew (no dynamic import on every call)
 *  3. GET / runs findMany + count in parallel (Promise.all) instead of sequential
 *  4. Default limit lowered to 20 (matches bell's request; was 50)
 *  5. Composite DB index added to schema (see migration note below)
 *
 * Migration required after deploying:
 *   npx prisma migrate dev --name add_notification_composite_index
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../services/database';
import { toSkipTake, buildMeta } from '../utils/pagination';
import { authenticate } from '../middleware/auth';
import { emitNotificationNew } from '../services/SocketService';
import { PushService } from '../services/PushService';

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface AuthUser {
  userId: string;
  familyId?: string;
  role: string;
}

function getUser(req: Request): AuthUser {
  return (req as any).user as AuthUser;
}

// ─── GET / - List notifications ───────────────────────────────────────────────

notificationsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const unreadOnly = req.query.unreadOnly === 'true';
    const { skip, take, page, limit } = toSkipTake(req.query);
    const where = { userId, ...(unreadOnly ? { isRead: false } : {}) };

    // Run all three in parallel - one round-trip's latency instead of three.
    const [notifications, unreadCount, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.notification.count({ where: { userId, isRead: false } }),
      // FR-07: a REAL count of matching rows. This used to report notifications.length, which
      // always equalled the page size, so a client could never tell more pages existed.
      prisma.notification.count({ where }),
    ]);

    res.json({
      notifications,
      unreadCount,
      total,
      pagination: buildMeta(total, page, limit),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications', detail: String(err) });
  }
});

// ─── GET /unread-count - Fast badge count ────────────────────────────────────

notificationsRouter.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const count = await prisma.notification.count({ where: { userId, isRead: false } });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch unread count', detail: String(err) });
  }
});

// ─── PUT /:id/read - Mark single notification as read ────────────────────────

notificationsRouter.put('/:id/read', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    if (notification.userId !== userId) {
      res.status(403).json({ error: 'Not your notification' });
      return;
    }

    // Run update + new count in parallel
    const [updated, unreadCount] = await Promise.all([
      prisma.notification.update({
        where: { id },
        data: { isRead: true, readAt: new Date() },
      }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    res.json({ notification: updated, unreadCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark notification as read', detail: String(err) });
  }
});

// ─── PUT /read-all - Mark all notifications as read ──────────────────────────

notificationsRouter.put('/read-all', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const result = await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    res.json({ updated: result.count, unreadCount: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark all notifications as read', detail: String(err) });
  }
});

// ─── DELETE /:id - Delete a notification ─────────────────────────────────────

notificationsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    if (notification.userId !== userId) {
      res.status(403).json({ error: 'Not your notification' });
      return;
    }

    // Run delete + new count in parallel
    const [, unreadCount] = await Promise.all([
      prisma.notification.delete({ where: { id } }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);

    res.json({ deleted: true, unreadCount });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete notification', detail: String(err) });
  }
});

// ─── POST /push/subscribe - Save web push subscription ───────────────────────

notificationsRouter.post('/push/subscribe', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const { endpoint, keys } = req.body as { endpoint: string; keys: { p256dh: string; auth: string } };
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: 'Invalid subscription object' });
      return;
    }
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dhKey: keys.p256dh, authKey: keys.auth },
      update: { userId, p256dhKey: keys.p256dh, authKey: keys.auth },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save subscription', detail: String(err) });
  }
});

// ─── DELETE /push/unsubscribe - Remove web push subscription ─────────────────

notificationsRouter.delete('/push/unsubscribe', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const { endpoint } = req.body as { endpoint?: string };
    const where = endpoint ? { endpoint } : { userId };
    await prisma.pushSubscription.deleteMany({ where: where as any });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove subscription', detail: String(err) });
  }
});

// ─── createNotification - internal helper ────────────────────────────────────

export async function createNotification(params: {
  userId: string;
  notificationType: string;
  title: string;
  message: string;
  actionUrl?: string;
  referenceType?: string;
  referenceId?: string;
}): Promise<void> {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId: params.userId,
        notificationType: params.notificationType,
        title: params.title,
        message: params.message,
        actionUrl: params.actionUrl,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
      },
    });

    // Static import - resolved once at module load, not on every call
    emitNotificationNew(params.userId, {
      notificationType: notification.notificationType,
      title: notification.title,
      message: notification.message,
      referenceType: notification.referenceType ?? undefined,
      referenceId: notification.referenceId ?? undefined,
    });

    // Fire-and-forget web push
    PushService.sendPush(params.userId, {
      title: params.title,
      body: params.message,
      actionUrl: params.actionUrl,
    }).catch(() => {});
  } catch (err) {
    console.error('[createNotification] failed:', err);
  }
}