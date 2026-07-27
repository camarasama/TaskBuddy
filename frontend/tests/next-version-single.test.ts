// Guard: exactly ONE Next.js version, and never a prerelease.
//
// 2026-07-27 production outage. `frontend/node_modules/next` held 16.3.0-canary.94 while the root
// workspace held stable 16.2.11. `npm run build:frontend` resolved the canary; the systemd unit
// runs `<repo>/node_modules/.bin/next start`, which resolved the stable one. The canary emits route
// code reading `experimental.instantInsights.validationLevel` — a canary-only config key the stable
// runtime never populates — so every dynamic route threw
// `TypeError: Cannot read properties of undefined (reading 'validationLevel')` and returned 500.
// Static pages are prebuilt HTML and were fine, which is why login and the dashboards looked
// healthy while /parent/tasks/[id], /parent/children/[id] and the /parent/approve/[id] email
// deep-link were all down.
//
// A green `npm run build` proved nothing: the build and the server were different programs. Hence
// this test rather than a comment.

import { execFileSync } from 'child_process';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND = path.resolve(__dirname, '..');

/** Version of `next` as resolved from a given directory — the thing that actually gets loaded. */
function resolveNextVersionFrom(dir: string): string {
  const script = 'console.log(require(require.resolve("next/package.json",{paths:[process.argv[1]]})).version)';
  return execFileSync(process.execPath, ['-e', script, dir], { encoding: 'utf8' }).trim();
}

describe('Next.js version is single and stable', () => {
  const fromFrontend = resolveNextVersionFrom(FRONTEND);
  const fromRoot = resolveNextVersionFrom(REPO_ROOT);

  it('resolves to the same version from the frontend workspace and the repo root', () => {
    // These two must match: the first is what builds the app, the second is what serves it.
    expect(fromFrontend).toBe(fromRoot);
  });

  it('is not a prerelease (canary/beta/rc/preview)', () => {
    expect(fromFrontend).not.toMatch(/-(canary|beta|rc|preview|alpha)/);
  });

  it('matches the exact version pinned in frontend/package.json', () => {
    // Pinned exactly, without a caret: the caret is what let the lockfile drift onto a prerelease
    // and then keep reinstalling it.
    const pinned = require('../package.json').dependencies.next as string;
    expect(pinned).not.toMatch(/^[\^~]/);
    expect(fromFrontend).toBe(pinned);
  });
});
