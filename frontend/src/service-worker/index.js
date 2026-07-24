// Push notification handlers - merged into sw.js by next-pwa in production

self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'TaskBuddy', {
      body: data.body || '',
      icon: data.icon || '/icon-192x192.png',
      badge: '/icon-96x96.png',
      data: { actionUrl: data.actionUrl || '/' },
    })
  );
});

// FR-13: offline task completions.
//
// The worker cannot replay them itself — the child's access token lives in localStorage, which is
// unreachable from here, and copying it into IndexedDB just to POST from the worker would widen
// token exposure for no real gain. So a background sync only wakes open clients and asks them to
// flush their queue; `useOfflineCompletions` does the actual work. Where Background Sync is
// unsupported (everything outside Chromium), the page's `online` listener covers the same ground.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'taskbuddy-completions') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      clientList.forEach((client) =>
        client.postMessage({ type: 'taskbuddy:flush-completions' })
      );
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.actionUrl || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
