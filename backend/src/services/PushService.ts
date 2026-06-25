import webpush from 'web-push';
import { prisma } from './database';

const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY  || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';
const vapidSubject    = process.env.VAPID_SUBJECT     || 'mailto:admin@taskbuddy.app';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

export interface PushPayload {
  title: string;
  body: string;
  actionUrl?: string;
  icon?: string;
}

export class PushService {
  static async sendPush(userId: string, payload: PushPayload): Promise<void> {
    if (!vapidPublicKey || !vapidPrivateKey) return; // VAPID not configured

    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return;

    const notification = JSON.stringify({
      title: payload.title,
      body: payload.body,
      actionUrl: payload.actionUrl ?? '/',
      icon: payload.icon ?? '/icon-192x192.png',
    });

    const staleIds: string[] = [];

    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dhKey, auth: sub.authKey } },
            notification,
          );
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            staleIds.push(sub.id); // subscription expired - clean up
          }
        }
      })
    );

    if (staleIds.length > 0) {
      await prisma.pushSubscription.deleteMany({ where: { id: { in: staleIds } } });
    }
  }
}
