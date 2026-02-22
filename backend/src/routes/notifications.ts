/**
 * notifications.ts — M10 Phase 4/5 (performance fix)
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
import { authenticate } from '../middleware/auth';
import { emitNotificationNew } from '../services/SocketService';

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

// ─── GET / — List notifications ───────────────────────────────────────────────

notificationsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const limit = Math.min(parseInt((req.query.limit as string) ?? '20', 10), 100);
    const unreadOnly = req.query.unreadOnly === 'true';

    // Run both queries in parallel — halves DB round-trips vs sequential awaits
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: {
          userId,
          ...(unreadOnly ? { isRead: false } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    res.json({ notifications, unreadCount, total: notifications.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications', detail: String(err) });
  }
});

// ─── GET /unread-count — Fast badge count ────────────────────────────────────

notificationsRouter.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const { userId } = getUser(req);
    const count = await prisma.notification.count({ where: { userId, isRead: false } });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch unread count', detail: String(err) });
  }
});

// ─── PUT /:id/read — Mark single notification as read ────────────────────────

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

// ─── PUT /read-all — Mark all notifications as read ──────────────────────────

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

// ─── DELETE /:id — Delete a notification ─────────────────────────────────────

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

// ─── createNotification — internal helper ────────────────────────────────────

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

    // Static import — resolved once at module load, not on every call
    emitNotificationNew(params.userId, {
      notificationType: notification.notificationType,
      title: notification.title,
      message: notification.message,
      referenceType: notification.referenceType ?? undefined,
      referenceId: notification.referenceId ?? undefined,
    });
  } catch (err) {
    console.error('[createNotification] failed:', err);
  }
}