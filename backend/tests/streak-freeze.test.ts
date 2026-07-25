/**
 * U6 — streak insurance (growth roadmap §4.3).
 *
 * Duolingo's most retention-positive mechanic, minus the anxiety: a missed day spends a banked
 * freeze instead of destroying a streak the child has been building for weeks.
 *
 * The arithmetic is the whole feature, so it lives in two pure functions and is tested exhaustively
 * here rather than through the database. The rule that needed the most thought is **all-or-nothing
 * spending**: a partial save would take the child's freezes AND reset their streak, which is the
 * worst of both and would feel like a bug rather than a mechanic.
 */

import {
  MAX_STREAK_FREEZES,
  STREAK_FREEZE_EARN_EVERY,
  applyStreakFreeze,
  earnStreakFreeze,
} from '../src/services/streakService';

describe('applyStreakFreeze — covering a gap', () => {
  it('spends ONE freeze for a single missed day and keeps the streak growing', () => {
    // daysSinceLast 2 = active on Monday, active on Wednesday, Tuesday missed.
    expect(applyStreakFreeze({ currentStreak: 10, daysSinceLast: 2, freezes: 1 })).toEqual({
      newStreak: 11,
      newFreezes: 0,
      consumed: 1,
    });
  });

  it('spends TWO for two missed days', () => {
    expect(applyStreakFreeze({ currentStreak: 10, daysSinceLast: 3, freezes: 2 })).toEqual({
      newStreak: 11,
      newFreezes: 0,
      consumed: 2,
    });
  });

  it('resets and spends NOTHING when the bank cannot cover the whole gap', () => {
    // The rule that matters: taking the freezes AND resetting would be the worst of both.
    expect(applyStreakFreeze({ currentStreak: 30, daysSinceLast: 4, freezes: 2 })).toEqual({
      newStreak: 1,
      newFreezes: 2,
      consumed: 0,
    });
  });

  it('resets when the bank is empty', () => {
    expect(applyStreakFreeze({ currentStreak: 12, daysSinceLast: 2, freezes: 0 })).toEqual({
      newStreak: 1,
      newFreezes: 0,
      consumed: 0,
    });
  });

  it('leaves the bank intact on a reset, so it protects the NEXT streak', () => {
    const result = applyStreakFreeze({ currentStreak: 20, daysSinceLast: 9, freezes: 2 });
    expect(result.newStreak).toBe(1);
    expect(result.newFreezes).toBe(2);
  });

  it('never returns a negative balance', () => {
    for (let gap = 2; gap <= 10; gap++) {
      for (let bank = 0; bank <= MAX_STREAK_FREEZES; bank++) {
        const { newFreezes } = applyStreakFreeze({ currentStreak: 5, daysSinceLast: gap, freezes: bank });
        expect(newFreezes).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('treats a same-day or backdated value as no missed days', () => {
    // FR-13 replays arrive with daysSinceLast <= 0; they must not spend a freeze.
    expect(applyStreakFreeze({ currentStreak: 8, daysSinceLast: 0, freezes: 2 }).consumed).toBe(0);
    expect(applyStreakFreeze({ currentStreak: 8, daysSinceLast: -3, freezes: 2 }).consumed).toBe(0);
  });
});

describe('earnStreakFreeze — banking one', () => {
  it('awards one on reaching a 7-day multiple', () => {
    expect(earnStreakFreeze({ newStreak: 7, previousStreak: 6, freezes: 0 })).toBe(1);
    expect(earnStreakFreeze({ newStreak: 14, previousStreak: 13, freezes: 0 })).toBe(1);
  });

  it('awards nothing between milestones', () => {
    expect(earnStreakFreeze({ newStreak: 8, previousStreak: 7, freezes: 1 })).toBe(1);
  });

  it('awards nothing when the streak did not advance', () => {
    // A second completion on the same day must not mint a freeze.
    expect(earnStreakFreeze({ newStreak: 7, previousStreak: 7, freezes: 0 })).toBe(0);
  });

  it('does not award on a reset that happens to land on a multiple', () => {
    expect(earnStreakFreeze({ newStreak: 1, previousStreak: 21, freezes: 0 })).toBe(0);
  });

  it('caps the bank rather than overflowing', () => {
    // A long streak must not silently bank credit the child can never spend.
    expect(earnStreakFreeze({ newStreak: 21, previousStreak: 20, freezes: MAX_STREAK_FREEZES })).toBe(
      MAX_STREAK_FREEZES,
    );
  });

  it('uses the documented cadence and cap', () => {
    expect(STREAK_FREEZE_EARN_EVERY).toBe(7);
    expect(MAX_STREAK_FREEZES).toBe(2);
  });
});

describe('earning and spending together', () => {
  it('a child cannot pay for a gap with a freeze earned by closing it', () => {
    // Spend is evaluated first, then earn. If the order were reversed a 6-day streak with an empty
    // bank could cover a missed day using the freeze it earns on day 7 — a free pass, every week.
    const spend = applyStreakFreeze({ currentStreak: 6, daysSinceLast: 2, freezes: 0 });
    expect(spend.newStreak).toBe(1); // reset: nothing banked to spend

    const after = earnStreakFreeze({
      newStreak: spend.newStreak,
      previousStreak: 6,
      freezes: spend.newFreezes,
    });
    expect(after).toBe(0);
  });

  it('a covered gap still advances toward the next milestone', () => {
    const spend = applyStreakFreeze({ currentStreak: 6, daysSinceLast: 2, freezes: 1 });
    expect(spend.newStreak).toBe(7);

    const after = earnStreakFreeze({ newStreak: 7, previousStreak: 6, freezes: spend.newFreezes });
    expect(after).toBe(1); // spent one to get here, earned one for arriving
  });
});
