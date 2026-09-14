/**
 * Source guard: a points balance is never written as a number computed in JavaScript.
 *
 * Fourteen call sites used to read `pointsBalance`, do the arithmetic, and write the result back.
 * Under concurrency that double-spends, double-refunds and silently loses credits (security audit,
 * 2026-09-14). The fix routes every change through `PointsWallet` (increment / guarded decrement),
 * and this test is what stops the pattern coming back in a new feature.
 *
 * The rule is mechanical: after `pointsBalance:` the value must be an object (`{ increment }`,
 * `{ decrement }`, `{ gte }` in a where clause), `true` (a select) or `number` (a type). Anything
 * else must be on the allow list below, with the reason it is safe.
 */
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', 'src');

/** file (relative to src) -> exact trimmed lines that are allowed, each with its reason. */
const ALLOWED: Record<string, string[]> = {
  // Email template data, not a database write.
  'jobs/agingOutCron.ts': ['pointsBalance: child.childProfile?.pointsBalance ?? 0,'],
  // API response shape, not a database write.
  'services/StreakShieldService.ts': ['pointsBalance: profile.pointsBalance,'],
  // Aging out: the decision is claimed first, and "nothing left on this account" is the intended end
  // state whatever arrived in between. See the comments at both sites.
  'services/TransitionService.ts': [
    'data: { pointsBalance: 0 },',
    'await tx.childProfile.updateMany({ where: { userId: row.childId }, data: { pointsBalance: 0 } });',
  ],
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });

describe('points balance writes', () => {
  it('never assign pointsBalance a computed value outside the allow list', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const match = line.match(/pointsBalance:\s*([^\s,})]+)/);
        if (!match) return;
        const value = match[1];
        if (value.startsWith('{') || value === 'true' || value.startsWith('number')) return;
        if ((ALLOWED[rel] ?? []).includes(line.trim())) return;
        offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it('keeps the allow list honest: every entry still exists', () => {
    for (const [rel, allowed] of Object.entries(ALLOWED)) {
      const lines = readFileSync(join(SRC, rel), 'utf8').split('\n').map((l) => l.trim());
      for (const line of allowed) expect(lines).toContain(line);
    }
  });
});
