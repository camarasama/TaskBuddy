/**
 * No screen or component may hardcode a hex colour.
 *
 * Every colour in this app is supposed to come from `useTheme()` (light/dark aware, see
 * `theme/index.ts`) or from `palette` directly. A literal `'#1e293b'` typed into a `StyleSheet`
 * bypasses both: it renders identically in light and dark mode — a slate-900 card on a slate-900
 * dark background disappears — and it drifts from the palette the moment a designer nudges a ramp
 * step, because nothing connects the literal back to the token it was copied from. `design-tokens.
 * test.ts` pins the token *values*; this file pins that screens actually *use* them.
 *
 * This is a source guard rather than a rendered-output check because RN's `StyleSheet.create` values
 * are opaque numbers by the time anything could inspect them at runtime — the only place "did someone
 * type a hex code" is still visible as text is the source file itself.
 *
 * The allowlist below is deliberately a named, commented constant. A source guard that can be
 * silenced by adding a path to an array is only as strong as the review discipline on that array, so
 * the reason for each entry is written next to it rather than left to be reconstructed later.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const HEX_LITERAL = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

const SCAN_ROOTS = [
  join(__dirname, '..', '..', '..', 'app'),
  join(__dirname, '..', '..', 'components'),
];

/**
 * Files permitted to contain a literal hex colour, each with the specific reason it cannot use the
 * theme. Adding a file here without a reason defeats the point of the test — the next hardcoded
 * colour would cite this entry as precedent.
 */
const ALLOWLIST: Record<string, string> = {
  'app/diagnostics.tsx':
    'Developer-only diagnostics screen: it deliberately renders a fixed dark terminal-style palette ' +
    'regardless of the device theme, so a support screenshot always looks the same and is never ' +
    'mistaken for a themed app screen.',
  'src/components/QRCode.tsx':
    'Draws a QR code from plain Views. Scanning requires true black modules on a true white field — ' +
    'substituting theme colours (which change with dark mode, and are never pure #000/#fff) would ' +
    'lower contrast and could make the code unreadable to a camera.',
};

function collectSourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(tsx|ts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// mobile/ — allowlist keys and reported paths are both relative to here, so a failure message reads
// the same way a developer would type the path.
const MOBILE_ROOT = join(__dirname, '..', '..', '..');

describe('no hardcoded hex colours outside the allowlist', () => {
  const files = SCAN_ROOTS.flatMap(collectSourceFiles);

  it('found source files to scan (a suite that scans nothing proves nothing)', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('flags every hex literal outside the two allowlisted files', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const relPath = relative(MOBILE_ROOT, file);
      if (relPath in ALLOWLIST) continue;

      const source = readFileSync(file, 'utf8');
      const matches = source.match(HEX_LITERAL);
      if (matches) {
        offenders.push(`${relPath}: ${matches.join(', ')}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it.each(Object.keys(ALLOWLIST))('%s exists and still contains what it is exempted for', (relPath) => {
    const source = readFileSync(join(MOBILE_ROOT, relPath), 'utf8');
    expect(source.match(HEX_LITERAL)?.length ?? 0).toBeGreaterThan(0);
  });

  it('pins the exact count of allowlisted literals, so a stray new one does not hide in the total', () => {
    // Currently 13 in diagnostics.tsx (a fixed dark palette for every field on the screen) and 2 in
    // QRCode.tsx (dark/light module colour). A change to either number means either a colour was
    // added or removed there — worth a second look even though the file stays allowlisted.
    const counts = Object.keys(ALLOWLIST).map((relPath) => {
      const source = readFileSync(join(MOBILE_ROOT, relPath), 'utf8');
      return source.match(HEX_LITERAL)?.length ?? 0;
    });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(15);
  });
});
