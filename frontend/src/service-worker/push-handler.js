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
