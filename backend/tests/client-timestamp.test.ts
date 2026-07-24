// streakService derives calendar days with local-time setHours(0,0,0,0), so the midnight-boundary
// case below only has one right answer if TZ is pinned. Must run before any Date-using import.
process.env.TZ = 'UTC';

/**
 * FR-13 — the clock rules behind the offline start/complete queue.
 *
 * A queued action carries the moment the CHILD acted, which the server may see minutes or hours
 * later. That timestamp is attacker-controlled (a phone's clock is two taps away), so it is only
 * honoured inside a window. This file pins the window itself, and — the reason the unit exists —
 * that an honoured timestamp actually reaches the streak's day maths, so a 23:50 completion synced
 * at 00:10 still counts for the 23rd.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    familySettings: { findUnique: jest.fn() },
    childProfile: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    pointsLedger: { create: jest.fn().mockResolvedValue({}) },
  },
}));
jest.mock('../src/services/SocketService', () => ({ emitStreakMilestone: jest.fn() }));

import {
  resolveClientTimestamp,
  CLIENT_CLOCK_SKEW_MS,
  CLIENT_TIMESTAMP_MAX_AGE_MS,
} from '../src/utils/clientTimestamp';
import { AppError } from '../src/middleware/errorHandler';
import { evaluateStreak } from '../src/services/streakService';
import { prisma } from '../src/services/database';

const NOW = new Date('2026-07-24T12:00:00.000Z');

describe('resolveClientTimestamp — absent means "exactly as before"', () => {
  it('returns the injected server now when the field is undefined', () => {
    expect(resolveClientTimestamp(undefined, { now: NOW }).getTime()).toBe(NOW.getTime());
  });

  it('returns server now for null and for an empty string', () => {
    expect(resolveClientTimestamp(null, { now: NOW }).getTime()).toBe(NOW.getTime());
    expect(resolveClientTimestamp('', { now: NOW }).getTime()).toBe(NOW.getTime());
  });

  it('defaults to the real clock when no `now` is injected', () => {
    const before = Date.now();
    const resolved = resolveClientTimestamp(undefined).getTime();
    expect(resolved).toBeGreaterThanOrEqual(before);
    expect(resolved).toBeLessThanOrEqual(Date.now());
  });
});

describe('resolveClientTimestamp — future timestamps are rejected (streak-farming vector)', () => {
  const future = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

  it('rejects a timestamp beyond the skew allowance with a 400 ValidationError', () => {
    expect(() => resolveClientTimestamp(future(CLIENT_CLOCK_SKEW_MS + 1000), { now: NOW }))
      .toThrow(/future/i);

    try {
      resolveClientTimestamp(future(60 * 60 * 1000), { now: NOW, field: 'completedAt' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).details?.[0].field).toBe('completedAt');
    }
  });

  it('rejects a wildly future timestamp (tomorrow) rather than clamping it', () => {
    expect(() => resolveClientTimestamp(future(24 * 60 * 60 * 1000), { now: NOW })).toThrow();
  });

  it('accepts ordinary forward clock drift but clamps it down to now', () => {
    const drifted = resolveClientTimestamp(future(30 * 1000), { now: NOW });
    expect(drifted.getTime()).toBe(NOW.getTime()); // never stores a future instant
  });

  it('accepts a timestamp exactly at the skew boundary', () => {
    expect(() => resolveClientTimestamp(future(CLIENT_CLOCK_SKEW_MS), { now: NOW })).not.toThrow();
  });
});

describe('resolveClientTimestamp — stale timestamps are clamped, not rejected', () => {
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it('takes a recent past timestamp at face value', () => {
    const twoHoursAgo = ago(2 * 60 * 60 * 1000);
    expect(resolveClientTimestamp(twoHoursAgo, { now: NOW }).toISOString()).toBe(twoHoursAgo);
  });

  it('clamps anything older than 48h up to now − 48h', () => {
    const resolved = resolveClientTimestamp(ago(10 * 24 * 60 * 60 * 1000), { now: NOW });
    expect(resolved.getTime()).toBe(NOW.getTime() - CLIENT_TIMESTAMP_MAX_AGE_MS);
  });

  it('keeps a timestamp exactly at the 48h edge unclamped', () => {
    const edge = ago(CLIENT_TIMESTAMP_MAX_AGE_MS);
    expect(resolveClientTimestamp(edge, { now: NOW }).toISOString()).toBe(edge);
  });

  it('rejects an unparseable value instead of silently falling back to now', () => {
    expect(() => resolveClientTimestamp('not-a-date', { now: NOW })).toThrow(/valid ISO-8601/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The point of the unit: the honoured timestamp must drive the streak's DAY.
// ─────────────────────────────────────────────────────────────────────────────

const settings = prisma.familySettings.findUnique as jest.Mock;
const findProfile = prisma.childProfile.findUnique as jest.Mock;
const updateProfile = prisma.childProfile.update as jest.Mock;

const written = () => updateProfile.mock.calls[0][0].data;

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

function freeze(iso: string) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(iso));
}

describe('evaluateStreak(asOf) — a late sync must not steal the streak day', () => {
  beforeEach(() => {
    settings.mockResolvedValue({ streakGracePeriodHours: 0 });
  });

  it('credits a 23:50 completion to the 23rd even though it is processed at 00:10 on the 24th', async () => {
    freeze('2026-07-24T00:10:00Z'); // the queue drained just after midnight
    findProfile.mockResolvedValue({
      currentStreakDays: 5,
      longestStreakDays: 5,
      lastActivityDate: new Date('2026-07-22T12:00:00Z'), // last active on the 22nd
      pointsBalance: 0,
    });

    // The child actually finished at 23:50 on the 23rd — one day after the 22nd.
    await evaluateStreak('c1', 'f1', new Date('2026-07-23T23:50:00Z'));

    expect(written().currentStreakDays).toBe(6); // extended, not reset
    expect((written().lastActivityDate as Date).toISOString()).toBe('2026-07-23T23:50:00.000Z');
  });

  it('BREAKS the same streak if the sync time is used instead — the bug this guards', async () => {
    freeze('2026-07-24T00:10:00Z');
    findProfile.mockResolvedValue({
      currentStreakDays: 5,
      longestStreakDays: 5,
      lastActivityDate: new Date('2026-07-22T12:00:00Z'),
      pointsBalance: 0,
    });

    await evaluateStreak('c1', 'f1'); // default asOf = now = the 24th → two-day gap

    expect(written().currentStreakDays).toBe(1); // reset — exactly what asOf prevents
  });

  it('leaves the default call site untouched (no asOf → server now)', async () => {
    freeze('2026-07-24T09:00:00Z');
    findProfile.mockResolvedValue({
      currentStreakDays: 5,
      longestStreakDays: 5,
      lastActivityDate: new Date('2026-07-23T12:00:00Z'),
      pointsBalance: 0,
    });

    await evaluateStreak('c1', 'f1');

    expect(written().currentStreakDays).toBe(6);
    expect((written().lastActivityDate as Date).toISOString()).toBe('2026-07-24T09:00:00.000Z');
  });

  it('a backdated replay for an already-credited day is a no-op, never a reset', async () => {
    freeze('2026-07-24T10:00:00Z');
    findProfile.mockResolvedValue({
      currentStreakDays: 7,
      longestStreakDays: 7,
      lastActivityDate: new Date('2026-07-24T09:00:00Z'), // already active today
      pointsBalance: 0,
    });

    // A two-day-old queued completion finally syncs.
    await evaluateStreak('c1', 'f1', new Date('2026-07-22T20:00:00Z'));

    expect(written().currentStreakDays).toBe(7); // unchanged
    // and lastActivityDate must not travel backwards
    expect((written().lastActivityDate as Date).toISOString()).toBe('2026-07-24T09:00:00.000Z');
  });

  it('applies the grace window against asOf, not against wall-clock now', async () => {
    settings.mockResolvedValue({ streakGracePeriodHours: 2 });
    freeze('2026-07-24T09:00:00Z'); // synced well past the 02:00 grace deadline
    findProfile.mockResolvedValue({
      currentStreakDays: 5,
      longestStreakDays: 5,
      lastActivityDate: new Date('2026-07-22T12:00:00Z'), // daysSinceLast === 2
      pointsBalance: 0,
    });

    // Child finished at 01:30, inside the grace window.
    await evaluateStreak('c1', 'f1', new Date('2026-07-24T01:30:00Z'));

    expect(written().currentStreakDays).toBe(6); // grace saved it
  });
});
