/**
 * `level` and `experiencePoints` have exactly one writer.
 *
 * Three things disagreed about what level a child was on:
 *
 *  1. `utils/gamification.ts`, exponential curve, `floor(100 * 1.5^(n-1))`, read over
 *     `totalXpEarned`. This is the one that writes `child_profiles.level`, so it is the one that
 *     wins, and `gamification-levels.test.ts` already pins its boundaries.
 *  2. `services/achievements.ts`, its own *polynomial* curve, read over `experiencePoints`. It
 *     decided every `level_reached` achievement, so a child could be handed "Reach Level 5" at a
 *     level nothing else in the system agreed they had.
 *  3. `experiencePoints` itself, documented as the within-level remainder that resets on level-up,
 *     which nothing ever reset. Every award site incremented it, so it silently became a second
 *     lifetime total - and the mobile "XP this level" stat and the web XP bar both read it.
 *
 * A fourth defect fell out while fixing them: achievement bonuses incremented `experiencePoints`
 * only, never `totalXpEarned`, so XP granted by an achievement could never advance a level at all.
 *
 * The fix makes `levelService.checkAndApplyLevelUp` the sole writer of both fields, deriving them
 * from `totalXpEarned`. These tests pin that, and the source guard at the bottom pins it repo-wide -
 * the defect was spread across four files, so testing one call path would let the next one ship.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

jest.mock('../src/services/database', () => ({
  prisma: {
    childProfile: { findUnique: jest.fn(), update: jest.fn() },
    pointsLedger: { create: jest.fn() },
  },
}));

import { checkAndApplyLevelUp } from '../src/services/levelService';
import { calculateLevelFromXp, xpRequiredForLevel } from '../src/utils/gamification';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  childProfile: { findUnique: jest.Mock; update: jest.Mock };
  pointsLedger: { create: jest.Mock };
};

/** Lifetime XP needed to sit exactly on the boundary of `level`. */
const cumulative = (level: number) => {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpRequiredForLevel(l);
  return total;
};

beforeEach(() => {
  jest.clearAllMocks();
  p.childProfile.update.mockResolvedValue({});
  p.pointsLedger.create.mockResolvedValue({});
});

describe('checkAndApplyLevelUp owns experiencePoints', () => {
  it('writes the within-level remainder, not a running total, when a child levels up', async () => {
    // 40 XP into level 3.
    const totalXpEarned = cumulative(3) + 40;
    p.childProfile.findUnique.mockResolvedValue({
      totalXpEarned,
      level: 2,
      experiencePoints: totalXpEarned, // the old, wrong, lifetime-shaped value
      pointsBalance: 0,
    });

    const result = await checkAndApplyLevelUp('child-1', 2);

    expect(result.leveledUp).toBe(true);
    expect(result.newLevel).toBe(3);
    expect(p.childProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ level: 3, experiencePoints: 40 }) })
    );
  });

  it('repairs a drifted remainder even when no level was gained', async () => {
    const totalXpEarned = cumulative(3) + 40;
    p.childProfile.findUnique.mockResolvedValue({
      totalXpEarned,
      level: 3,
      experiencePoints: 999, // drifted
      pointsBalance: 0,
    });

    const result = await checkAndApplyLevelUp('child-1', 3);

    expect(result.leveledUp).toBe(false);
    expect(p.childProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { level: 3, experiencePoints: 40 } })
    );
  });

  it('writes nothing when both projections already agree with lifetime XP', async () => {
    const totalXpEarned = cumulative(3) + 40;
    p.childProfile.findUnique.mockResolvedValue({
      totalXpEarned,
      level: 3,
      experiencePoints: 40,
      pointsBalance: 0,
    });

    await checkAndApplyLevelUp('child-1', 3);

    expect(p.childProfile.update).not.toHaveBeenCalled();
  });

  it('keeps the remainder below the cost of the level the child is on', async () => {
    // The property that makes it a progress bar rather than a counter: for any lifetime XP, the
    // remainder is always less than what the current level costs. The old field failed this
    // constantly - it exceeded it the moment a child passed level 2.
    for (let xp = 0; xp < 20_000; xp += 149) {
      const { level, currentLevelXp } = calculateLevelFromXp(xp);
      expect(currentLevelXp).toBeGreaterThanOrEqual(0);
      expect(currentLevelXp).toBeLessThan(xpRequiredForLevel(level));
    }
  });
});

/**
 * Source guard. The rule is narrow and mechanical on purpose: incrementing `experiencePoints` is
 * what turned a remainder into a lifetime counter, and it is the exact edit that would undo this.
 * Assignment is still allowed - `levelService` derives it, and `TaskService.revokeApproval` clamps
 * it - but no caller may add to it.
 */
describe('no source file increments experiencePoints', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
    });

  const files = sourceFiles(join(__dirname, '..', 'src'));

  it('finds source files to check at all', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((f) => [f.split('/src/')[1], f]))('%s', (_name, full) => {
    const source = readFileSync(full, 'utf8');
    // Matches `experiencePoints: { increment: … }` and the decrement twin, across line breaks.
    expect(source).not.toMatch(/experiencePoints\s*:\s*\{\s*(increment|decrement)/);
  });
});

/**
 * The losing formula must stay gone. It lived in `shared` as `GAMIFICATION.LEVEL` and was read with
 * `Math.pow(level, GROWTH_FACTOR)`; re-adding either half is how the two curves come back.
 */
describe('there is only one level curve', () => {
  it('shared no longer exports a level block for anyone to compute from', () => {
    const shared = readFileSync(
      join(__dirname, '..', '..', 'shared', 'src', 'constants', 'index.ts'),
      'utf8'
    );
    expect(shared).not.toMatch(/^\s*LEVEL\s*:\s*\{/m);
  });

  it('achievements judges level_reached with the shared curve over totalXpEarned', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'services', 'achievements.ts'),
      'utf8'
    );
    expect(source).toMatch(/calculateLevelFromXp\(profile\.totalXpEarned\)/);
    // No locally defined curve.
    expect(source).not.toMatch(/Math\.pow\(/);
  });

  /**
   * The web keeps its own copy of the curve, because the browser cannot import a backend util. A
   * copy is tolerable; a copy that DIFFERS is the original bug. This compares the two directly, so
   * editing one and not the other fails here rather than in a child's XP bar.
   */
  it("the frontend's xpForLevel is the same curve as the backend's", () => {
    const utils = readFileSync(
      join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'utils.ts'),
      'utf8'
    );

    const body = utils.slice(utils.indexOf('export function xpForLevel'));
    const base = body.match(/BASE_XP\s*=\s*(\d+)/)?.[1];
    const growth = body.match(/GROWTH_FACTOR\s*=\s*([\d.]+)/)?.[1];

    expect(Number(base)).toBe(100);
    expect(Number(growth)).toBe(1.5);
    // Exponential in the level (growth^(level-1)), not polynomial (level^growth).
    expect(body).toMatch(/Math\.pow\(GROWTH_FACTOR,\s*level\s*-\s*1\)/);
  });

  /**
   * `levelFromXp` consumes LIFETIME XP: it subtracts one level's cost at a time until the remainder
   * no longer covers one. Handing it `experiencePoints`, now that the backend genuinely resets that
   * on level-up, pins the display to Level 1. Both call sites must pass the lifetime field.
   */
  it.each([
    ['components/layouts/ChildLayout.tsx'],
    ['app/child/dashboard/page.tsx'],
  ])('%s feeds levelFromXp lifetime XP, not the within-level remainder', (file) => {
    const source = readFileSync(
      join(__dirname, '..', '..', 'frontend', 'src', ...file.split('/')),
      'utf8'
    );

    const argument = source.match(/levelFromXp\((\w+)\)/)?.[1];
    expect(argument).toBeDefined();

    // Whatever local name the argument has, its assignment must read totalXpEarned first.
    const assignment = source.match(new RegExp(`const ${argument}\\s*=\\s*([^;]+);`))?.[1] ?? '';
    expect(assignment).toContain('totalXpEarned');
  });
});
