/**
 * src/sw.ts - the web app's service worker (Serwist, replacing next-pwa, 2026-10-27).
 *
 * Built by @serwist/next into public/sw.js, the same URL next-pwa used, so browsers that already
 * have the old worker update to this one on their next visit.
 *
 * Two jobs, same as before:
 *  1. Caching: precache the build and apply Serwist's default runtime rules (the successor of the
 *     next-pwa defaults), so the app shell still opens with no signal. That is what lets FR-13's
 *     offline start/complete queue work in the garden or the garage.
 *  2. Web push: show the notification and open its action URL on click (moved unchanged from
 *     src/service-worker/index.js).
 */

import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// next-pwa's Workbox precache. Serwist uses its own cache name, so without this the old copy of
// every build file would sit on each device forever.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n.startsWith('workbox-precache')).map((n) => caches.delete(n))),
    ),
  );
});

// ─── Web push ───────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'TaskBuddy', {
      body: data.body || '',
      icon: data.icon || '/icon-192x192.png',
      badge: '/icon-96x96.png',
      data: { actionUrl: data.actionUrl || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.actionUrl || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => c.url === url && 'focus' in c);
      if (existing) return (existing as WindowClient).focus();
      return self.clients.openWindow(url);
    }),
  );
});
