/**
 * U16 — quiet hours and schooltime mode (growth roadmap §6).
 *
 * §11 lists *"quiet hours respected in push scheduling"* among the binding guardrails, and nothing
 * implemented it: pushes fired at any hour of the night.
 *
 * Two properties carry the feature, and both are easy to get subtly wrong:
 *
 *  - **The wrapping window is the normal case.** Quiet hours are 20:00 → 07:00. A naive
 *    `start <= t && t < end` is false for every minute of that range, so the feature would appear to
 *    work (no crash, no error) while silencing nothing at all.
 *  - **Windows mean nothing without the right timezone.** 20:00–07:00 evaluated in UTC for a family
 *    in Denver silences the wrong hours, and the parent believes they are covered.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    familySettings: { findUnique: jest.fn() },
  },
}));

import {
  evaluateWindows,
  isPushSuppressed,
  isWithinWindow,
  localClock,
  parseHm,
  type WindowSettings,
} from '../src/services/QuietHoursService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  user: { findUnique: jest.Mock };
  familySettings: { findUnique: jest.Mock };
};

const OFF: WindowSettings = {
  quietHoursEnabled: false,
  quietHoursStart: '20:00',
  quietHoursEnd: '07:00',
  schooltimeEnabled: false,
  schooltimeStart: '08:30',
  schooltimeEnd: '15:30',
  schooltimeDays: [1, 2, 3, 4, 5],
};

/** minutes since local midnight for HH:MM, for readable assertions. */
const at = (hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
};

beforeEach(() => {
  jest.clearAllMocks();
  p.user.findUnique.mockResolvedValue(null);
  p.familySettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
});

// ─── parseHm ──────────────────────────────────────────────────────────────────

describe('parseHm', () => {
  it('parses a normal time', () => {
    expect(parseHm('20:30')).toBe(20 * 60 + 30);
    expect(parseHm('00:00')).toBe(0);
  });

  it('rejects an out-of-range clock', () => {
    expect(parseHm('24:00')).toBeNull();
    expect(parseHm('12:60')).toBeNull();
  });

  it('rejects junk rather than coercing it', () => {
    // A NaN reaching the comparison would silently mean "never suppressed".
    for (const bad of ['', 'bedtime', '8pm', '20', '20:0:0']) {
      expect(parseHm(bad)).toBeNull();
    }
  });
});

// ─── AC-U16b: the window rule ─────────────────────────────────────────────────

describe('isWithinWindow', () => {
  it('handles a same-day window', () => {
    expect(isWithinWindow(at('14:00'), '13:00', '15:00')).toBe(true);
    expect(isWithinWindow(at('12:59'), '13:00', '15:00')).toBe(false);
  });

  it('handles the window that WRAPS midnight — the normal quiet-hours case', () => {
    // A naive start<=t<end is false for every one of these, so the feature would look fine and
    // silence nothing.
    expect(isWithinWindow(at('23:30'), '20:00', '07:00')).toBe(true);
    expect(isWithinWindow(at('03:00'), '20:00', '07:00')).toBe(true);
    expect(isWithinWindow(at('06:59'), '20:00', '07:00')).toBe(true);
  });

  it('ends the wrapping window exactly at its end time', () => {
    expect(isWithinWindow(at('07:00'), '20:00', '07:00')).toBe(false);
    expect(isWithinWindow(at('12:00'), '20:00', '07:00')).toBe(false);
  });

  it('includes the start minute and excludes the end minute', () => {
    expect(isWithinWindow(at('20:00'), '20:00', '07:00')).toBe(true);
    expect(isWithinWindow(at('15:30'), '08:30', '15:30')).toBe(false);
  });

  it('treats a zero-length window as covering nothing, not everything', () => {
    // "All day" off a typo would silence a family completely.
    expect(isWithinWindow(at('12:00'), '20:00', '20:00')).toBe(false);
  });

  it('never suppresses on an unparseable time', () => {
    expect(isWithinWindow(at('23:00'), 'bedtime', '07:00')).toBe(false);
  });
});

// ─── AC-U16c / AC-U16d: timezone ──────────────────────────────────────────────

describe('localClock', () => {
  it('reads the wall clock in the given zone, not UTC', () => {
    // 02:00 UTC is 21:00 the previous day in Denver (MDT, UTC-6) — inside quiet hours there but
    // not in UTC. Getting this wrong is the whole "silences the wrong hours" failure.
    const instant = new Date('2026-07-22T02:00:00Z');
    expect(localClock(instant, 'UTC').minutes).toBe(at('02:00'));
    expect(localClock(instant, 'America/Denver').minutes).toBe(at('20:00'));
  });

  it('rolls the weekday back with the zone', () => {
    // Wednesday 02:00 UTC is still Tuesday evening in Denver.
    const instant = new Date('2026-07-22T02:00:00Z'); // a Wednesday
    expect(localClock(instant, 'UTC').weekday).toBe(3);
    expect(localClock(instant, 'America/Denver').weekday).toBe(2);
  });

  it('applies DST via the platform tz database', () => {
    // January: Denver is MST (UTC-7), so the same 02:00Z is 19:00, not 20:00.
    expect(localClock(new Date('2026-01-22T02:00:00Z'), 'America/Denver').minutes).toBe(at('19:00'));
  });

  it('normalises midnight rather than reporting hour 24', () => {
    // Some ICU builds render 00:xx as 24:xx under en-GB hour12:false; 24*60 would sort after every
    // window and quietly break the wrap comparison.
    expect(localClock(new Date('2026-07-22T00:15:00Z'), 'UTC').minutes).toBe(15);
  });

  // AC-U16d
  it('falls back to UTC on an unknown timezone instead of throwing', () => {
    // A bad timezone string must never take notification delivery down with it.
    const instant = new Date('2026-07-22T02:00:00Z');
    expect(localClock(instant, 'Mars/Olympus_Mons').minutes).toBe(at('02:00'));
    expect(localClock(instant, '').minutes).toBe(at('02:00'));
  });
});

// ─── The combined rule ────────────────────────────────────────────────────────

describe('evaluateWindows', () => {
  // AC-U16f
  it('suppresses nothing when both features are off', () => {
    expect(evaluateWindows(OFF, { minutes: at('03:00'), weekday: 3 })).toEqual({ suppressed: false });
  });

  it('suppresses inside quiet hours', () => {
    const settings = { ...OFF, quietHoursEnabled: true };
    expect(evaluateWindows(settings, { minutes: at('03:00'), weekday: 3 })).toEqual({
      suppressed: true,
      reason: 'quiet_hours',
    });
  });

  it('allows outside quiet hours', () => {
    const settings = { ...OFF, quietHoursEnabled: true };
    expect(evaluateWindows(settings, { minutes: at('17:00'), weekday: 3 }).suppressed).toBe(false);
  });

  // AC-U16e
  it('suppresses during schooltime on a school day', () => {
    const settings = { ...OFF, schooltimeEnabled: true };
    expect(evaluateWindows(settings, { minutes: at('10:00'), weekday: 3 })).toEqual({
      suppressed: true,
      reason: 'schooltime',
    });
  });

  it('does NOT suppress school hours at the weekend', () => {
    // Saturday morning is not school. Suppressing it would be the feature quietly overreaching.
    const settings = { ...OFF, schooltimeEnabled: true };
    expect(evaluateWindows(settings, { minutes: at('10:00'), weekday: 6 }).suppressed).toBe(false);
    expect(evaluateWindows(settings, { minutes: at('10:00'), weekday: 7 }).suppressed).toBe(false);
  });

  it('honours a custom school-day set', () => {
    const settings = { ...OFF, schooltimeEnabled: true, schooltimeDays: [6] };
    expect(evaluateWindows(settings, { minutes: at('10:00'), weekday: 6 }).suppressed).toBe(true);
    expect(evaluateWindows(settings, { minutes: at('10:00'), weekday: 1 }).suppressed).toBe(false);
  });

  it('suppresses nothing when the school-day set is empty', () => {
    const settings = { ...OFF, schooltimeEnabled: true, schooltimeDays: [] };
    expect(evaluateWindows(settings, { minutes: at('10:00'), weekday: 3 }).suppressed).toBe(false);
  });

  it('reports quiet hours when both windows overlap', () => {
    // Only the reason differs, but it is what gets logged — the more specific cause should not win
    // arbitrarily.
    const settings = {
      ...OFF,
      quietHoursEnabled: true, quietHoursStart: '09:00', quietHoursEnd: '11:00',
      schooltimeEnabled: true,
    };
    expect(evaluateWindows(settings, { minutes: at('10:00'), weekday: 3 }).reason).toBe('quiet_hours');
  });
});

// ─── The database-backed check ────────────────────────────────────────────────

describe('isPushSuppressed', () => {
  function user(over: Partial<WindowSettings> = {}) {
    return { familyId: 'fam-1', ...OFF, ...over };
  }

  it('allows the push when the user has opted into nothing', async () => {
    p.user.findUnique.mockResolvedValue(user());
    expect(await isPushSuppressed('u1')).toEqual({ suppressed: false });
  });

  it('does not even look up the timezone on the common path', async () => {
    // Every push in the product takes this branch today; it must not cost a second query.
    p.user.findUnique.mockResolvedValue(user());
    await isPushSuppressed('u1');
    expect(p.familySettings.findUnique).not.toHaveBeenCalled();
  });

  // AC-U16c, end to end.
  it('evaluates the window in the FAMILY timezone', async () => {
    p.user.findUnique.mockResolvedValue(user({ quietHoursEnabled: true }));
    p.familySettings.findUnique.mockResolvedValue({ timezone: 'America/Denver' });

    // 02:00 UTC = 20:00 in Denver → inside 20:00-07:00 there, outside it in UTC.
    const instant = new Date('2026-07-22T02:00:00Z');
    expect((await isPushSuppressed('u1', instant)).suppressed).toBe(true);

    p.familySettings.findUnique.mockResolvedValue({ timezone: 'UTC' });
    expect((await isPushSuppressed('u1', instant)).suppressed).toBe(true); // 02:00 UTC is also quiet

    // 14:00 UTC = 08:00 Denver: quiet in neither.
    expect((await isPushSuppressed('u1', new Date('2026-07-22T14:00:00Z'))).suppressed).toBe(false);
  });

  it('defaults to UTC when the family has no settings row', async () => {
    p.user.findUnique.mockResolvedValue(user({ quietHoursEnabled: true }));
    p.familySettings.findUnique.mockResolvedValue(null);
    expect((await isPushSuppressed('u1', new Date('2026-07-22T03:00:00Z'))).suppressed).toBe(true);
  });

  it('allows the push for an unknown user', async () => {
    p.user.findUnique.mockResolvedValue(null);
    expect(await isPushSuppressed('nobody')).toEqual({ suppressed: false });
  });

  // The failure mode that would be worst and least visible.
  it('FAILS OPEN when the lookup errors', async () => {
    // A silent, invisible loss of notifications is a worse bug than an ill-timed buzz.
    p.user.findUnique.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect((await isPushSuppressed('u1')).suppressed).toBe(false);
    jest.restoreAllMocks();
  });
});

// ─── AC-U16g / AC-U16h: what suppression must and must not touch ──────────────

describe('blast radius', () => {
  it('is consulted ONLY by PushService', () => {
    // AC-U16h. §11 binds "no mechanism may ever remove a child's earned points, streaks or
    // history", so quiet hours must gate the buzz and nothing else. If a future change wires this
    // into approval, expiry or the streak sweep, that is a behaviour change worth failing on rather
    // than discovering from a child who lost a streak overnight.
    const { execSync } = require('child_process') as typeof import('child_process');
    // Matches the IMPORT, not the name — a comment mentioning the service is not a consumer of it.
    const hits = execSync(
      "grep -rlE \"from '[./]*(services/)?QuietHoursService'\" src || true",
      { cwd: `${__dirname}/..`, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .sort();

    expect(hits).toEqual(['src/services/PushService.ts']);
  });

  it('holds the push without touching the notification or socket path', () => {
    // AC-U16g. The check lives inside sendPush, AFTER createNotification has already written the
    // row and emitted the socket event — so a suppressed push loses nothing, it just does not buzz.
    const { readFileSync } = require('fs') as typeof import('fs');
    const push = readFileSync(`${__dirname}/../src/services/PushService.ts`, 'utf8');
    const notifications = readFileSync(`${__dirname}/../src/routes/notifications.ts`, 'utf8');

    // The gate is in sendPush, not at the call site.
    expect(push).toContain('isPushSuppressed');
    expect(notifications).not.toContain('isPushSuppressed');
    // And it returns before any subscription is read.
    expect(push.indexOf('isPushSuppressed')).toBeLessThan(push.indexOf('pushSubscription.findMany'));
  });
});
