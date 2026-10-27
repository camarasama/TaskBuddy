#!/usr/bin/env node
/**
 * scripts/strip-sw-sourcemap.mjs - runs after `next build` in frontend (2026-10-27).
 *
 * @serwist/next builds the service worker with the main build's webpack settings. When the Sentry
 * upload token is present (production), Sentry turns source maps on, so the worker build also
 * writes public/sw.js.map. Sentry only deletes the maps it uploads from .next, so this one stayed
 * in public/ and was served to anyone at /sw.js.map, the exact thing the 2026-09-14 security audit
 * removed when next-pwa had it. This deletes it, and any sourceMappingURL pointing at it.
 *
 * Usage: node scripts/strip-sw-sourcemap.mjs [publicDir]   (default: frontend/public)
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = process.argv[2] ?? join(root, 'frontend', 'public');
const map = join(publicDir, 'sw.js.map');
const sw = join(publicDir, 'sw.js');

let removed = false;
if (existsSync(map)) {
  rmSync(map);
  removed = true;
}
if (existsSync(sw)) {
  const src = readFileSync(sw, 'utf8');
  const stripped = src.replace(/\n?\/\/# sourceMappingURL=sw\.js\.map\s*$/, '');
  if (stripped !== src) writeFileSync(sw, stripped);
}
console.log(removed ? 'Removed public/sw.js.map (must not be served).' : 'No public/sw.js.map to remove.');
