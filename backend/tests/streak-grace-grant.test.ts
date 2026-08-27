/**
 * Per-incident parent grace grant (growth roadmap §11.3).
 *
 * The family's `streakGracePeriodHours` is a POLICY: every day, every child, measured in hours past
 * midnight. A grant is a RESPONSE: one child, one evening, and it expires by itself. Both feed one
 * deadline, and `graceDeadlineFor` is where they meet.
 *
 * The rule under test is "the later of the two wins", and it is the only combination that cannot
 * surprise a parent:
 *
 *   - A grant must never be SHORTENED by a stricter standing policy. The parent did something
 *     deliberate; a policy they set weeks ago must not quietly undo it.
 *   - A policy must never be shortened by an EXPIRED grant. A family that already allows until 4am
 *     should not lose that because last Tuesday's grant lapsed at midnight.
 *
 * Getting this backwards fails silently: the streak simply breaks overnight and nobody can see why,
 * which is the same class of bug as the freeze-ordering one in vacation mode.
 */

import { graceDeadlineFor } from '../src/services/streakService';

/** Midnight today, the reference point the service derives the window from. */
const midnight = new Date('2026-08-27T00:00:00');
const at = (iso: string) => new Date(iso);

describe('graceDeadlineFor — policy alone', () => {
  it('closes the window N hours past midnight', () => {
    expect(
      graceDeadlineFor({ todayMidnight: midnight, gracePeriodHours: 4, graceGrantedUntil: null }),
    ).toEqual(at('2026-08-27T04:00:00'));
  });

  it('collapses to midnight when the family has grace turned off', () => {
    // 0 hours is the documented default in isStreakAtRisk. `now` is never <= midnight at the point
    // the service compares, so this correctly means "no grace at all".
    expect(
      graceDeadlineFor({ todayMidnight: midnight, gracePeriodHours: 0, graceGrantedUntil: null }),
    ).toEqual(midnight);
  });
});

describe('graceDeadlineFor — a grant extends, and only extends', () => {
  it('uses the grant when it runs later than the policy', () => {
    expect(
      graceDeadlineFor({
        todayMidnight: midnight,
        gracePeriodHours: 4,
        graceGrantedUntil: at('2026-08-27T20:00:00'),
      }),
    ).toEqual(at('2026-08-27T20:00:00'));
  });

  it('keeps the policy when it is already more generous than the grant', () => {
    // The grant must not SHORTEN an existing window. A family on 6 hours that grants until 02:00
    // still has until 06:00.
    expect(
      graceDeadlineFor({
        todayMidnight: midnight,
        gracePeriodHours: 6,
        graceGrantedUntil: at('2026-08-27T02:00:00'),
      }),
    ).toEqual(at('2026-08-27T06:00:00'));
  });

  it('works for a family whose standing policy is off', () => {
    // The case the feature exists for, and the one the old `gracePeriodHours > 0` guard broke: with
    // no policy, the grant is the ONLY source of grace, so ignoring it would make the grant a no-op.
    expect(
      graceDeadlineFor({
        todayMidnight: midnight,
        gracePeriodHours: 0,
        graceGrantedUntil: at('2026-08-27T21:00:00'),
      }),
    ).toEqual(at('2026-08-27T21:00:00'));
  });

  it('ignores a grant that has already lapsed, without shortening the policy', () => {
    // A spent grant falls out of the max naturally rather than needing to be cleared first.
    expect(
      graceDeadlineFor({
        todayMidnight: midnight,
        gracePeriodHours: 4,
        graceGrantedUntil: at('2026-08-25T20:00:00'),
      }),
    ).toEqual(at('2026-08-27T04:00:00'));
  });

  it('carries a grant that runs into tomorrow', () => {
    // Granted at 9pm for 24 hours, so it outlives today's midnight boundary. The deadline is the
    // grant's own moment, not something clamped back into today.
    expect(
      graceDeadlineFor({
        todayMidnight: midnight,
        gracePeriodHours: 4,
        graceGrantedUntil: at('2026-08-28T21:00:00'),
      }),
    ).toEqual(at('2026-08-28T21:00:00'));
  });
});

describe('graceDeadlineFor — the two sources never fight', () => {
  it.each([
    ['policy longer', 8, '2026-08-27T03:00:00', '2026-08-27T08:00:00'],
    ['grant longer', 2, '2026-08-27T09:00:00', '2026-08-27T09:00:00'],
    ['exactly equal', 5, '2026-08-27T05:00:00', '2026-08-27T05:00:00'],
  ])('%s → takes the later', (_label, hours, grant, expected) => {
    expect(
      graceDeadlineFor({
        todayMidnight: midnight,
        gracePeriodHours: hours as number,
        graceGrantedUntil: at(grant as string),
      }),
    ).toEqual(at(expected as string));
  });

  it('never returns earlier than the policy alone would', () => {
    // Property form of the rule above: whatever the grant, the window cannot shrink.
    const policyOnly = graceDeadlineFor({
      todayMidnight: midnight,
      gracePeriodHours: 4,
      graceGrantedUntil: null,
    });

    for (const grant of ['2026-08-01T00:00:00', '2026-08-27T01:00:00', '2026-08-30T23:00:00']) {
      const withGrant = graceDeadlineFor({
        todayMidnight: midnight,
        gracePeriodHours: 4,
        graceGrantedUntil: at(grant),
      });
      expect(withGrant.getTime()).toBeGreaterThanOrEqual(policyOnly.getTime());
    }
  });
});
