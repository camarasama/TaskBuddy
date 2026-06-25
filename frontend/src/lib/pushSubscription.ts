const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function subscribeToPush(): Promise<void> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !VAPID_PUBLIC_KEY) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const sub = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as unknown as ArrayBuffer,
    });
    await fetch('/api/v1/notifications/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('accessToken') ?? sessionStorage.getItem('accessToken') ?? ''}` },
      credentials: 'include',
      body: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')!))), auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth')!))) } }),
    });
  } catch {
    // Push permission denied or not supported - non-fatal
  }
}
