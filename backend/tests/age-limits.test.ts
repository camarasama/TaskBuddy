/**
 * The age rules, and the boundaries that only exist on one day of the year.
 *
 * These numbers were literals in ten places across four packages before 2026-08-11. Ten copies of a
 * product rule is ten chances for a form and its API to disagree, and the symptom of that is a
 * parent entering a date the form accepts and the server rejects after they press the button.
 *
 * `now` is injected throughout. A test that uses the real clock passes on 364 days a year and fails
 * on the one that matters, which is worse than no test: it would be reported as flakiness and
 * retried rather than read.
 */
import { AGE_LIMITS, isAgeBetween } from '@taskbuddy/shared';

// A Wednesday, deliberately mid-month and mid-year so no boundary is accidental.
const NOW = new Date(2026, 7, 11); // 11 August 2026, local

describe('AGE_LIMITS', () => {
  it('pins the product rule so a refactor cannot move it silently', () => {
    expect(AGE_LIMITS.CHILD_MIN).toBe(10);
    expect(AGE_LIMITS.CHILD_MAX).toBe(16);
    expect(AGE_LIMITS.ADULT_MIN).toBe(18);
  });

  it('keeps the child ceiling below the adult floor, or aging out has a gap', () => {
    // A child can be at most CHILD_MAX; conversion happens at ADULT_MIN. If these ever met or
    // crossed, someone would be simultaneously too old to be a child and too young to convert.
    expect(AGE_LIMITS.CHILD_MAX).toBeLessThan(AGE_LIMITS.ADULT_MIN);
  });
});

describe('isAgeBetween — child window', () => {
  const child = (dob: string) => isAgeBetween(dob, AGE_LIMITS.CHILD_MIN, AGE_LIMITS.CHILD_MAX, NOW);

  it('admits someone who turns 10 today', () => {
    // The birthday itself counts. Excluding it would reject a child on exactly the day they qualify.
    expect(child('2016-08-11')).toBe(true);
  });

  it('refuses someone who turns 10 tomorrow', () => {
    expect(child('2016-08-12')).toBe(false);
  });

  it('admits someone still 16, whose 17th is tomorrow', () => {
    expect(child('2009-08-12')).toBe(true);
  });

  it('refuses someone who turns 17 today', () => {
    // The far edge, and the one most easily written as >= by mistake: 17 today is too old, because
    // the window is inclusive of 16 and nothing beyond.
    expect(child('2009-08-11')).toBe(false);
  });

  it('refuses well outside on both sides', () => {
    expect(child('2020-01-01')).toBe(false);
    expect(child('2000-01-01')).toBe(false);
  });

  it('treats a 29 February birthday as having passed by 1 March in a common year', () => {
    // Subtracting calendar years is what makes this work without special-casing. A child born
    // 29 Feb 2016 is 10 as of 1 March 2026.
    expect(isAgeBetween('2016-02-29', 10, 16, new Date(2026, 2, 1))).toBe(true);
  });
});

describe('isAgeBetween — adult floor', () => {
  const adult = (dob: string, now = NOW) => isAgeBetween(dob, AGE_LIMITS.ADULT_MIN, null, now);

  it('admits someone who turns 18 today', () => {
    expect(adult('2008-08-11')).toBe(true);
  });

  it('refuses someone who turns 18 tomorrow', () => {
    expect(adult('2008-08-12')).toBe(false);
  });

  it('has no upper bound', () => {
    // maxYears null is the open-ended case; a 100-year-old must not fall out of the window.
    expect(adult('1926-01-01')).toBe(true);
  });
});

describe('isAgeBetween — malformed input', () => {
  it.each(['', 'not-a-date', '2016-13-45', 'null'])('rejects %p rather than throwing', (bad) => {
    // A malformed string reaching a validator must be a refusal, not a 500.
    expect(() => isAgeBetween(bad, 10, 16, NOW)).not.toThrow();
    expect(isAgeBetween(bad, 10, 16, NOW)).toBe(false);
  });
});
