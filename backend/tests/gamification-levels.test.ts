import {
  calculateLevelFromXp,
  xpRequiredForLevel,
} from '../src/utils/gamification';

/**
 * FR-03 — level thresholds. `checkAndApplyLevelUp` delegates the actual arithmetic to
 * `calculateLevelFromXp`, so that is where the boundaries live and where a regression would bite:
 * an off-by-one here silently awards or withholds a level-up bonus for every child.
 *
 * Curve: xpRequiredForLevel(n) = floor(100 * 1.5^(n-1)) → 100, 150, 225, 337, 506 …
 * Levels are cumulative, so the lifetime XP needed to REACH level n is the running sum.
 */

const cumulative = (level: number) => {
  let total = 0;
  for (let l = 1; l < level; l++) total += xpRequiredForLevel(l);
  return total;
};

describe('xpRequiredForLevel', () => {
  it('follows the documented 100 × 1.5^(n-1) curve', () => {
    expect(xpRequiredForLevel(1)).toBe(100);
    expect(xpRequiredForLevel(2)).toBe(150);
    expect(xpRequiredForLevel(3)).toBe(225);
    expect(xpRequiredForLevel(4)).toBe(337);
  });

  it('grows monotonically, so a later level is never cheaper than an earlier one', () => {
    for (let l = 1; l < 20; l++) {
      expect(xpRequiredForLevel(l + 1)).toBeGreaterThan(xpRequiredForLevel(l));
    }
  });
});

describe('calculateLevelFromXp boundaries', () => {
  it('starts every child at level 1 with zero XP', () => {
    expect(calculateLevelFromXp(0)).toMatchObject({ level: 1, currentLevelXp: 0 });
  });

  it('does not promote one XP short of the threshold', () => {
    expect(calculateLevelFromXp(cumulative(2) - 1).level).toBe(1);
  });

  it('promotes exactly ON the threshold — the boundary a >= vs > bug would move', () => {
    expect(calculateLevelFromXp(cumulative(2)).level).toBe(2);
    expect(calculateLevelFromXp(cumulative(3)).level).toBe(3);
    expect(calculateLevelFromXp(cumulative(4)).level).toBe(4);
  });

  it('carries the remainder into the new level rather than discarding it', () => {
    const result = calculateLevelFromXp(cumulative(3) + 40);
    expect(result.level).toBe(3);
    expect(result.currentLevelXp).toBe(40);
  });

  it('reports the cost of the CURRENT level as xpToNextLevel', () => {
    expect(calculateLevelFromXp(cumulative(3)).xpToNextLevel).toBe(xpRequiredForLevel(3));
  });

  it('never skips a level when XP arrives in one large lump', () => {
    // A big correction or bonus should still land on the correct single level, not overshoot.
    const level = calculateLevelFromXp(cumulative(6)).level;
    expect(level).toBe(6);
  });

  it('is monotonic in XP — more lifetime XP can never mean a lower level', () => {
    let previous = 0;
    for (let xp = 0; xp < 3000; xp += 37) {
      const { level } = calculateLevelFromXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});
