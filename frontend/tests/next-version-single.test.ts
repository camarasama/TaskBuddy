// Guard: exactly ONE Next.js version, and never a prerelease.
//
// 2026-07-27 production outage. `frontend/node_modules/next` held 16.3.0-canary.94 while the root
// workspace held stable 16.2.11. `npm run build:frontend` resolved the canary; the systemd unit
// runs `<repo>/node_modules/.bin/next start`, which resolved the stable one. The canary emits route
// code reading `experimental.instantInsights.validationLevel`, a canary-only config key the stable
// runtime never populates, so every dynamic route threw
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

/** Version of `next` as resolved from a given directory, the thing that actually gets loaded. */
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

// Guard: the web app's React matches the React that Next actually runs (2026-10-27).
//
// Next 16 bundles its own React for the browser and server (next/dist/compiled/react, 19.3 canary
// with Next 16.4.3). Until this change frontend/package.json said React 18.3, so Jest and tsc
// checked React 18 while users ran React 19: tests did not test what shipped. The web now declares
// React 19.3; this keeps the two on the same minor so that never silently drifts back.

function resolveVersionFrom(dir: string, pkg: string): string {
  const script = `console.log(require(require.resolve("${pkg}/package.json",{paths:[process.argv[1]]})).version)`;
  return execFileSync(process.execPath, ['-e', script, dir], { encoding: 'utf8' }).trim();
}

function nextBundledReactVersion(): string {
  const nextDir = path.dirname(require.resolve('next/package.json', { paths: [FRONTEND] }));
  const src = require('fs').readFileSync(path.join(nextDir, 'dist/compiled/react/cjs/react.production.js'), 'utf8');
  const m = /exports\.version = "([^"]+)"/.exec(src);
  if (!m) throw new Error('could not read the React version Next bundles');
  return m[1];
}

const minor = (v: string) => v.split('.').slice(0, 2).join('.');

describe('web React matches the React Next runs', () => {
  const react = resolveVersionFrom(FRONTEND, 'react');
  const reactDom = resolveVersionFrom(FRONTEND, 'react-dom');
  const bundled = nextBundledReactVersion();

  it('react and react-dom are the same version', () => {
    expect(reactDom).toBe(react);
  });

  it('is on the same major.minor as the React bundled in Next', () => {
    expect(minor(react)).toBe(minor(bundled));
  });

  it('tests run the same React as the app declares', () => {
    expect(require('react').version).toBe(react);
  });
});
