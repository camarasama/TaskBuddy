#!/usr/bin/env node
/**
 * scripts/check-prerelease-deps.mjs - closes npm audit's prerelease blind spot (2026-10-27).
 *
 * npm audit matches advisories with semver ranges, and a version with a tag (`1.4.5-lts.2`) is a
 * prerelease that ranges like `< 2.3.0` do NOT include. That is how multer 1.4.5-lts.2 carried about
 * eight high-severity DoS advisories for months while audit reported nothing (fixed in #218).
 *
 * This fails CI when any non-dev package in package-lock.json has a tagged version that is not in
 * KNOWN below. A new entry is a prompt to check that package's advisories BY HAND (GitHub advisory
 * database), then either upgrade it or add it here with the reason.
 *
 * Usage: node scripts/check-prerelease-deps.mjs [path/to/package-lock.json]
 *        (defaults to the repo lockfile; exit 1 on an unknown tagged version)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** name@version -> why it is acceptable. Checked by hand on the date given. */
const KNOWN = {
  // Babel build tooling, never shipped to users. Checked 2026-10-27: no advisories.
  'gensync@1.0.0-beta.2': 'babel build tooling, no advisories',
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(process.argv[2] ?? join(root, 'package-lock.json'), 'utf8'));

const unknown = [];
const seen = new Set();
for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
  if (!path || !pkg.version || pkg.link || pkg.dev || pkg.devOptional) continue;
  if (!pkg.version.includes('-')) continue;
  const name = path.split('node_modules/').pop();
  const id = `${name}@${pkg.version}`;
  seen.add(id);
  if (!(id in KNOWN)) unknown.push(`${id}  (${path})`);
}

// A KNOWN entry that no longer occurs would silently excuse it if it ever came back: fail on it.
const stale = Object.keys(KNOWN).filter((id) => !seen.has(id));
if (stale.length) {
  console.error('Stale entries in KNOWN (no longer in package-lock.json), remove them:');
  for (const s of stale) console.error(`  - ${s}`);
  process.exit(1);
}

if (unknown.length) {
  console.error('Non-dev packages with a prerelease-style version (npm audit cannot match these):');
  for (const u of unknown) console.error(`  - ${u}`);
  console.error('\nCheck each one in the GitHub advisory database, then upgrade it or add it to KNOWN');
  console.error('in scripts/check-prerelease-deps.mjs with the reason.');
  process.exit(1);
}
console.log(`Prerelease check passed (${Object.keys(KNOWN).length} known, 0 unknown).`);
