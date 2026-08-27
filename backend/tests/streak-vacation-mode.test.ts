/**
 * Vacation mode (growth roadmap §11.2).
 *
 * A parent declares a range of days the family is away, and those days stop counting as a gap. The
 * arithmetic lives in two pure functions so it can be tested exhaustively without a database, the
 * same shape `streak-freeze.test.ts` uses for §4.3.
 *
 * Three properties carry the feature, and each has its own block below:
 *
 *  1. **A pause preserves, it never advances.** A fortnight away must not out-earn a fortnight of
 *     chores, so paused days are removed from the gap rather than credited as activity.
 *  2. **Paused days are discounted BEFORE freezes are considered.** A day the parent declared away
 *     is not a missed day at all, so it must never cost a freeze the child earned. Getting this
 *     backwards would silently bill a child for their own holiday, which is the single most likely
 *     way this feature could go wrong without anyone noticing.
 *  3. **The endpoints of the gap are excluded.** The last-activity day was worked and today is the
 *     day being credited, so neither is a missed day a pause could cover. Off-by-one here would
 *     either leak a free day or waste one of the parent's.
 */

import {
  MAX_STREAK_PAUSE_DAYS,
  applyStreakFreeze,
  isPausedOn,
  pausedDaysInGap,
} from '../src/services/streakService';

/** Local midnight, matching how the service derives every day boundary. */
const day = (iso: string) => new Date(`${iso}T00:00:00`);

describe('pausedDaysInGap — how much of a gap the holiday covers', () => {
  it('counts a pause that covers the whole gap', () => {
    // Worked Mon 3rd, back Fri 7th. Missed 4th, 5th, 6th. Away for exactly those three.
    expect(
      pausedDaysInGap({
        lastActivity: day('2026-08-03'),
        now: day('2026-08-07'),
        pausedFrom: day('2026-08-04'),
        pausedUntil: day('2026-08-06'),
      }),
    ).toBe(3);
  });

  it('counts only the overlap when the pause is wider than the gap', () => {
    // Away for a fortnight but back at it after two days: only the two missed days can be covered.
    expect(
      pausedDaysInGap({
        lastActivity: day('2026-08-03'),
        now: day('2026-08-06'),
        pausedFrom: day('2026-07-25'),
        pausedUntil: day('2026-08-20'),
      }),
    ).toBe(2);
  });

  it('excludes the last-activity day and today, which are not missed days', () => {
    // A pause spanning ONLY those two endpoints covers nothing: the 3rd was worked, the 5th is being
    // credited now, and the 4th (the one real gap day) is outside the range.
    expect(
      pausedDaysInGap({
        lastActivity: day('2026-08-03'),
        now: day('2026-08-05'),
        pausedFrom: day('2026-08-03'),
        pausedUntil: day('2026-08-03'),
      }),
    ).toBe(0);
  });

  it('returns 0 when the pause sits entirely outside the gap', () => {
    expect(
      pausedDaysInGap({
        lastActivity: day('2026-08-10'),
        now: day('2026-08-13'),
        pausedFrom: day('2026-07-01'),
        pausedUntil: day('2026-07-14'),
      }),
    ).toBe(0);
  });

  it('returns 0 when there is no pause set', () => {
    expect(
      pausedDaysInGap({
        lastActivity: day('2026-08-03'),
        now: day('2026-08-07'),
        pausedFrom: null,
        pausedUntil: null,
      }),
    ).toBe(0);
  });

  it('returns 0 for a half-set pause rather than guessing the missing end', () => {
    // Both columns are written together, so one without the other is corrupt data, not a range that
    // runs to infinity. Guessing an end date here would silently protect a streak forever.
    expect(
      pausedDaysInGap({
        lastActivity: day('2026-08-03'),
        now: day('2026-08-07'),
        pausedFrom: day('2026-08-04'),
        pausedUntil: null,
      }),
    ).toBe(0);
  });

  it('returns 0 for an inverted range instead of a negative count', () => {
    expect(
      pausedDaysInGap({
        lastActivity: day('2026-08-03'),
        now: day('2026-08-09'),
        pausedFrom: day('2026-08-07'),
        pausedUntil: day('2026-08-04'),
      }),
    ).toBe(0);
  });

  it('covers no days when the child was active yesterday, pause or not', () => {
    // daysSinceLast === 1 never reaches the gap branch in the service, but the helper must still
    // report 0 rather than a stray day, so the two can never disagree.
    expect(
      pausedDaysInGap({
        lastActivity: day('2026-08-06'),
        now: day('2026-08-07'),
        pausedFrom: day('2026-08-01'),
        pausedUntil: day('2026-08-31'),
      }),
    ).toBe(0);
  });
});

describe('the pause is applied before freezes are spent', () => {
  /**
   * Mirrors the service: paused days come off `daysSinceLast`, and what is left goes to the freeze
   * logic. Written out here so the ORDER is pinned by a test rather than by a comment.
   */
  const evaluate = (params: {
    currentStreak: number;
    lastActivity: Date;
    now: Date;
    freezes: number;
    pausedFrom: Date | null;
    pausedUntil: Date | null;
  }) => {
    const daysSinceLast = Math.floor(
      (day(params.now.toISOString().slice(0, 10)).getTime() -
        day(params.lastActivity.toISOString().slice(0, 10)).getTime()) /
        86_400_000,
    );
    const paused = pausedDaysInGap({
      lastActivity: params.lastActivity,
      now: params.now,
      pausedFrom: params.pausedFrom,
      pausedUntil: params.pausedUntil,
    });
    const effectiveDays = daysSinceLast - paused;

    // Mirrors the service exactly, including the branch that matters: a fully covered gap is "no
    // gap", NOT a zero-day gap handed to the freeze logic, which reads that as a reset.
    if (effectiveDays <= 1) {
      return { newStreak: params.currentStreak + 1, newFreezes: params.freezes, consumed: 0 };
    }

    return applyStreakFreeze({
      currentStreak: params.currentStreak,
      daysSinceLast: effectiveDays,
      freezes: params.freezes,
    });
  };

  it('spends NO freezes when the holiday covers the whole gap', () => {
    // The property that matters most: a child with freezes banked still has all of them afterwards.
    expect(
      evaluate({
        currentStreak: 30,
        lastActivity: day('2026-08-03'),
        now: day('2026-08-07'),
        freezes: 2,
        pausedFrom: day('2026-08-04'),
        pausedUntil: day('2026-08-06'),
      }),
    ).toEqual({ newStreak: 31, newFreezes: 2, consumed: 0 });
  });

  it('advances the streak by exactly one across a holiday, not by its length', () => {
    // Fourteen days away, one day of credit. A pause preserves; it does not pay.
    const result = evaluate({
      currentStreak: 30,
      lastActivity: day('2026-08-01'),
      now: day('2026-08-16'),
      freezes: 0,
      pausedFrom: day('2026-08-02'),
      pausedUntil: day('2026-08-15'),
    });
    expect(result.newStreak).toBe(31);
  });

  it('spends a freeze only for the days the holiday did NOT cover', () => {
    // Away the 4th and 5th, but also idle on the 6th. One real missed day, one freeze.
    expect(
      evaluate({
        currentStreak: 10,
        lastActivity: day('2026-08-03'),
        now: day('2026-08-07'),
        freezes: 2,
        pausedFrom: day('2026-08-04'),
        pausedUntil: day('2026-08-05'),
      }),
    ).toEqual({ newStreak: 11, newFreezes: 1, consumed: 1 });
  });

  it('still resets when the uncovered remainder outruns the freeze bank', () => {
    // A pause is not a blanket amnesty: three uncovered days against one freeze is all-or-nothing,
    // so the streak resets and the freeze is kept for the streak about to start.
    expect(
      evaluate({
        currentStreak: 40,
        lastActivity: day('2026-08-01'),
        now: day('2026-08-08'),
        freezes: 1,
        pausedFrom: day('2026-08-02'),
        pausedUntil: day('2026-08-04'),
      }),
    ).toEqual({ newStreak: 1, newFreezes: 1, consumed: 0 });
  });

  it('behaves exactly as before when no pause is set', () => {
    // Regression guard for §4.3: adding vacation mode must not change any existing outcome.
    expect(
      evaluate({
        currentStreak: 10,
        lastActivity: day('2026-08-03'),
        now: day('2026-08-05'),
        freezes: 1,
        pausedFrom: null,
        pausedUntil: null,
      }),
    ).toEqual({ newStreak: 11, newFreezes: 0, consumed: 1 });
  });
});

describe('isPausedOn — used to silence at-risk alerts', () => {
  it('is true on the first and last day of the pause, which are inclusive', () => {
    const range = { pausedFrom: day('2026-08-10'), pausedUntil: day('2026-08-14') };
    expect(isPausedOn({ on: day('2026-08-10'), ...range })).toBe(true);
    expect(isPausedOn({ on: day('2026-08-14'), ...range })).toBe(true);
  });

  it('is false either side of the range', () => {
    const range = { pausedFrom: day('2026-08-10'), pausedUntil: day('2026-08-14') };
    expect(isPausedOn({ on: day('2026-08-09'), ...range })).toBe(false);
    expect(isPausedOn({ on: day('2026-08-15'), ...range })).toBe(false);
  });

  it('ignores the time of day, so an evening cron matches a date-only range', () => {
    expect(
      isPausedOn({
        on: new Date('2026-08-12T21:45:00'),
        pausedFrom: day('2026-08-10'),
        pausedUntil: day('2026-08-14'),
      }),
    ).toBe(true);
  });

  it('is false when no pause is set', () => {
    expect(isPausedOn({ on: day('2026-08-12'), pausedFrom: null, pausedUntil: null })).toBe(false);
  });
});

describe('MAX_STREAK_PAUSE_DAYS', () => {
  it('is bounded, so a pause cannot become a permanent freeze', () => {
    expect(MAX_STREAK_PAUSE_DAYS).toBeGreaterThan(0);
    expect(MAX_STREAK_PAUSE_DAYS).toBeLessThanOrEqual(60);
  });
});
