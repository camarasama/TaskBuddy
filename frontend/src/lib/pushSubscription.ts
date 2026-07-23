import { notificationsApi } from './api';

// Read at call time rather than module load. Next inlines NEXT_PUBLIC_* at build time either way,
// so the browser bundle is identical — but a module-level const is captured before any test can
// set it, which made this function untestable.
function vapidPublicKey(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function encodeKey(key: ArrayBuffer | null): string {
  if (!key) throw new Error('push subscription is missing a required key');
  return btoa(String.fromCharCode(...new Uint8Array(key)));
}

/**
 * Register this browser for push and persist the subscription server-side.
 *
 * Returns whether the subscription was actually persisted. Callers may ignore the result — push is
 * an enhancement, never load-bearing — but it must not be *silently* dropped: the previous version
 * discarded every failure, which is how the bug below survived unnoticed.
 *
 * Fixed here: the POST used raw `fetch` with `Bearer ${localStorage.accessToken}`. Parent/admin
 * tokens are memory-only under the F-5 storage policy, so that header was empty and the request
 * 401'd for every parent — the majority of push recipients. It now goes through `notificationsApi`,
 * which reads the same token source as the rest of the app.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  const vapidKey = vapidPublicKey();
  if (!vapidKey) {
    console.warn('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set — push disabled');
    return false;
  }

  let sub: PushSubscription;
  try {
    const reg = await navigator.serviceWorker.ready;
    sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
      }));
  } catch (err) {
    // Permission denied or unsupported browser — expected, not worth shouting about.
    console.info('[push] not subscribed:', (err as Error)?.message ?? err);
    return false;
  }

  try {
    await notificationsApi.subscribePush({
      endpoint: sub.endpoint,
      keys: {
        p256dh: encodeKey(sub.getKey('p256dh')),
        auth: encodeKey(sub.getKey('auth')),
      },
    });
    return true;
  } catch (err) {
    // Reaching here means the browser granted push but we failed to store it: the user gets no
    // notifications, and nothing else in the system would reveal that.
    console.error('[push] failed to persist subscription:', (err as Error)?.message ?? err);
    return false;
  }
}
