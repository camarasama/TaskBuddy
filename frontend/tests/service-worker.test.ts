import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * The web service worker (Serwist since 2026-10-27, replacing next-pwa) carries web push. If a
 * future change drops the handlers, notifications stop arriving and nothing else fails, so the
 * essentials are pinned here. Verified in a real browser on 2026-10-27: registration, precache,
 * offline reload from cache, and the push/click handlers.
 */

const root = join(__dirname, '..');
const sw = readFileSync(join(root, 'src/sw.ts'), 'utf8');
const nextConfig = readFileSync(join(root, 'next.config.js'), 'utf8');

it('builds src/sw.ts to /sw.js, the URL existing browsers already registered', () => {
  expect(nextConfig).toMatch(/swSrc:\s*'src\/sw\.ts'/);
  expect(nextConfig).toMatch(/swDest:\s*'public\/sw\.js'/);
  expect(nextConfig).not.toContain("require('next-pwa')");
});

it('keeps the push and notification-click handlers', () => {
  expect(sw).toContain("addEventListener('push'");
  expect(sw).toContain('showNotification(');
  expect(sw).toContain("addEventListener('notificationclick'");
  expect(sw).toContain('openWindow(');
});

it('keeps offline caching (precache + runtime rules) for the FR-13 offline queue', () => {
  expect(sw).toContain('precacheEntries: self.__SW_MANIFEST');
  expect(sw).toContain('runtimeCaching: defaultCache');
});

it('clears the old next-pwa precache from devices', () => {
  expect(sw).toContain("startsWith('workbox-precache')");
});

it('the old custom worker folder is gone (its handlers now live in src/sw.ts)', () => {
  expect(existsSync(join(root, 'src/service-worker'))).toBe(false);
});
