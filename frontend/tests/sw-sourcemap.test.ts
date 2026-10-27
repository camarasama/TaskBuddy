import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * /sw.js.map must never be published (security audit 2026-09-14). With Serwist, the worker inherits
 * source maps from the main build whenever the Sentry token is set, which only happens on the
 * server, so a local build never shows the problem. The build script therefore always strips it.
 */

const script = join(__dirname, '..', '..', 'scripts', 'strip-sw-sourcemap.mjs');

it('the frontend build runs the strip step after next build', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
  expect(pkg.scripts.build).toBe('next build --webpack && node ../scripts/strip-sw-sourcemap.mjs');
});

it('deletes sw.js.map and the pointer to it, and leaves the worker otherwise intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-'));
  writeFileSync(join(dir, 'sw.js'), 'self.addEventListener("push",()=>{});\n//# sourceMappingURL=sw.js.map');
  writeFileSync(join(dir, 'sw.js.map'), '{"version":3}');
  execFileSync(process.execPath, [script, dir]);
  expect(existsSync(join(dir, 'sw.js.map'))).toBe(false);
  expect(readFileSync(join(dir, 'sw.js'), 'utf8')).toBe('self.addEventListener("push",()=>{});');
});

it('is a no-op when there is no map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw-'));
  writeFileSync(join(dir, 'sw.js'), 'x');
  expect(() => execFileSync(process.execPath, [script, dir])).not.toThrow();
  expect(readFileSync(join(dir, 'sw.js'), 'utf8')).toBe('x');
});
