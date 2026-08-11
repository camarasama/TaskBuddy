import webpush from 'web-push';
import { prisma } from './database';
import { isPushSuppressed } from './QuietHoursService';

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
  /**
   * Deliver to every channel this user has, subject to quiet hours.
   *
   * ⚠️ The VAPID guard used to be the FIRST line of this method. Adding Expo delivery after it would
   * have meant mobile pushes silently never sending on any deployment without web-push keys
   * configured — a whole platform disabled by an unrelated config check. The guard now gates only
   * the web half, which is the only half it describes.
   *
   * Quiet hours are checked once, here, so both channels honour them and a future third channel
   * cannot forget to.
   */
  static async sendPush(userId: string, payload: PushPayload): Promise<void> {
    // U16 — quiet hours / schooltime. Checked HERE rather than in createNotification so a future
    // direct caller cannot bypass it by accident. Only the push is held: the notification row and
    // the socket emit have already happened, so nothing is lost — it simply does not buzz.
    const quiet = await isPushSuppressed(userId);
    if (quiet.suppressed) return;

    // Independent: a dead web subscription must not stop the phone buzzing, and vice versa.
    await Promise.allSettled([
      PushService.sendWebPush(userId, payload),
      PushService.sendExpoPush(userId, payload),
    ]);
  }

  private static async sendWebPush(userId: string, payload: PushPayload): Promise<void> {
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
  /**
   * Expo push, for the Android app.
   *
   * Sent through Expo's service rather than talking to FCM directly: the app is built with EAS and
   * its tokens are Expo tokens, so this is the transport that matches the credentials we actually
   * have. No API key is required for sends to Expo tokens.
   *
   * A `DeviceNotRegistered` ticket means the app was uninstalled or the token rotated. Those rows
   * are deleted rather than retried, for the same reason web push deletes on 410: keeping them means
   * every future send pays for a delivery that can never succeed.
   */
  private static async sendExpoPush(userId: string, payload: PushPayload): Promise<void> {
    const tokens = await prisma.expoPushToken.findMany({ where: { userId }, select: { token: true } });
    if (tokens.length === 0) return;

    const messages = tokens.map((t) => ({
      to: t.token,
      title: payload.title,
      body: payload.body,
      // Carried in `data` rather than the title so the app can route on tap without parsing prose.
      data: { actionUrl: payload.actionUrl ?? '/' },
      sound: 'default' as const,
    }));

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!response.ok) return;

      const body = (await response.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
      const dead: string[] = [];
      body.data?.forEach((ticket, i) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          dead.push(messages[i].to);
        }
      });

      if (dead.length > 0) {
        await prisma.expoPushToken.deleteMany({ where: { token: { in: dead } } });
      }
    } catch (err) {
      // Never throw: this runs fire-and-forget behind createNotification, and a push outage must
      // not turn into a failed request for the action that produced the notification.
      console.error('[PushService] expo send failed:', (err as Error)?.message);
    }
  }

}
