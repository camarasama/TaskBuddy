/**
 * Which dashboard treatment a child gets.
 *
 * The rule under test is a product judgement, not a calculation: 10 to 16 is two audiences, and
 * addressing a 16-year-old like a 10-year-old is the failure that makes them stop opening the app.
 * So the boundary, and the fallbacks around it, are worth pinning.
 */
import { resolveAgeBand, BAND_COPY, YOUNGER_BAND_MAX } from '../ageBand';

// Fixed so the boundary cases are testable at all. With a real clock these pass most of the year
// and fail on one day, which gets reported as flakiness and retried rather than read.
const NOW = new Date(2026, 7, 11);
const dobFor = (age: number) => new Date(NOW.getFullYear() - age, NOW.getMonth(), NOW.getDate()).toISOString().slice(0, 10);

describe('resolveAgeBand', () => {
  it('gives 10, 11 and 12 year olds the playful treatment', () => {
    for (const age of [10, 11, 12]) {
      expect(resolveAgeBand({ dateOfBirth: dobFor(age) })).toBe('younger');
    }
  });

  it('gives 13 to 16 year olds the composed treatment', () => {
    for (const age of [13, 14, 15, 16]) {
      expect(resolveAgeBand({ dateOfBirth: dobFor(age) })).toBe('older');
    }
  });

  it('switches band on the 13th birthday itself', () => {
    // The whole point: a child must not still be addressed as a little kid on the day they turn 13.
    expect(resolveAgeBand({ dateOfBirth: dobFor(YOUNGER_BAND_MAX) })).toBe('younger');
    expect(resolveAgeBand({ dateOfBirth: dobFor(YOUNGER_BAND_MAX + 1) })).toBe('older');
  });

  it('prefers the birth date over the stored bucket, because the bucket goes stale', () => {
    // ageGroup was correct when written. A child who has since had a birthday is in the wrong
    // bucket until something rewrites it; the date of birth cannot be stale.
    expect(resolveAgeBand({ dateOfBirth: dobFor(15), ageGroup: '10-12' })).toBe('older');
  });

  it('falls back to the stored bucket when there is no birth date', () => {
    expect(resolveAgeBand({ ageGroup: '10-12' })).toBe('younger');
    expect(resolveAgeBand({ ageGroup: '13-16' })).toBe('older');
  });

  it('defaults to the composed treatment when it knows nothing', () => {
    // Asymmetric on purpose: showing a 10-year-old the plainer screen costs some delight, showing a
    // 16-year-old the playful one costs the user.
    expect(resolveAgeBand({})).toBe('older');
    expect(resolveAgeBand({ dateOfBirth: null, ageGroup: null })).toBe('older');
  });
});

describe('BAND_COPY', () => {
  it('gives both bands a written voice, not one warm line and one system default', () => {
    // The easy failure is writing something friendly for the younger band and leaving the older
    // band with whatever the component said before, which reads as the app caring less about them.
    for (const band of ['younger', 'older'] as const) {
      expect(BAND_COPY[band].greeting('Ada')).toContain('Ada');
      expect(BAND_COPY[band].todayLabel.length).toBeGreaterThan(0);
      expect(BAND_COPY[band].emptyToday.length).toBeGreaterThan(0);
    }
    expect(BAND_COPY.younger.greeting('Ada')).not.toBe(BAND_COPY.older.greeting('Ada'));
  });
});
