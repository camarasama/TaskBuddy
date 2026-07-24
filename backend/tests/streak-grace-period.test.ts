// Pin the timezone BEFORE anything imports Date-using code: streakService computes "midnight" with
// local-time setHours(0,0,0,0), so which calendar day it is — and where the grace deadline falls —
// depends on TZ. UTC makes the boundary maths deterministic in any CI runner.
process.env.TZ = 'UTC';

/**
 * FR-03 — streak grace-period boundaries (evaluateStreak, isStreakAtRisk).
 *
 * The grace window lets a streak survive if the child completes a task within N hours after
 * midnight of a missed day. Its whole behaviour turns on `now <= graceDeadline` (a <=, inclusive of
 * the exact deadline), and on `now` being the real wall clock — which is why this went untested.
 * We freeze the clock with fake timers so the two rows that matter — exactly AT the deadline vs one
 * minute past — are reproducible.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    familySettings: { findUnique: jest.fn() },
    childProfile: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    pointsLedger: { create: jest.fn().mockResolvedValue({}) },
  },
}));
jest.mock('../src/services/SocketService', () => ({
  emitStreakMilestone: jest.fn(),
}));

import { evaluateStreak, isStreakAtRisk } from '../src/services/streakService';
import { prisma } from '../src/services/database';

const settings = prisma.familySettings.findUnique as jest.Mock;
const findProfile = prisma.childProfile.findUnique as jest.Mock;
const updateProfile = prisma.childProfile.update as jest.Mock;

/** Days before the frozen "today", at midday so it is unambiguously that calendar date. */
const daysAgo = (n: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
};

/** The streak value written by the last evaluateStreak call. */
const writtenStreak = () => updateProfile.mock.calls[0][0].data.currentStreakDays as number;

afterEach(() => {
  jest.useRealTimers(); // MUST reset — a leaked frozen clock breaks session/retention time maths
  jest.clearAllMocks();
});

function freeze(iso: string) {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(iso));
}

function profile(overrides: Record<string, unknown> = {}) {
  findProfile.mockResolvedValue({
    currentStreakDays: 5,
    longestStreakDays: 5,
    lastActivityDate: null,
    pointsBalance: 0,
    ...overrides,
  });
}

describe('evaluateStreak — non-grace boundaries', () => {
  it('starts a streak at 1 for a child with no prior activity', async () => {
    freeze('2026-07-24T09:00:00Z');
    settings.mockResolvedValue({ streakGracePeriodHours: 0 });
    profile({ currentStreakDays: 0, lastActivityDate: null });

    await evaluateStreak('c1', 'f1');
    expect(writtenStreak()).toBe(1);
  });

  it('extends the streak when the last activity was yesterday', async () => {
    freeze('2026-07-24T09:00:00Z');
    settings.mockResolvedValue({ streakGracePeriodHours: 0 });
    profile({ currentStreakDays: 5, lastActivityDate: daysAgo(1) });

    await evaluateStreak('c1', 'f1');
    expect(writtenStreak()).toBe(6);
  });

  it('leaves the streak unchanged when already active today', async () => {
    freeze('2026-07-24T20:00:00Z');
    settings.mockResolvedValue({ streakGracePeriodHours: 0 });
    profile({ currentStreakDays: 5, lastActivityDate: daysAgo(0) });

    await evaluateStreak('c1', 'f1');
    expect(writtenStreak()).toBe(5);
  });

  it('resets to 1 when two days were missed and there is no grace period', async () => {
    freeze('2026-07-24T09:00:00Z');
    settings.mockResolvedValue({ streakGracePeriodHours: 0 });
    profile({ currentStreakDays: 5, lastActivityDate: daysAgo(2) });

    await evaluateStreak('c1', 'f1');
    expect(writtenStreak()).toBe(1);
  });
});

describe('evaluateStreak — the grace-window boundary (the reason this test exists)', () => {
  // grace = 2h → deadline is 02:00 today. lastActivity two days ago → daysSinceLast === 2.
  const twoDaysAgo = () => profile({ currentStreakDays: 5, lastActivityDate: daysAgo(2) });

  it('SAVES the streak when now is within the grace window', async () => {
    freeze('2026-07-24T01:00:00Z'); // 01:00 < 02:00 deadline
    settings.mockResolvedValue({ streakGracePeriodHours: 2 });
    twoDaysAgo();

    await evaluateStreak('c1', 'f1');
    expect(writtenStreak()).toBe(6); // grace extended it
  });

  it('SAVES the streak exactly AT the deadline — the <= boundary', async () => {
    freeze('2026-07-24T02:00:00.000Z'); // now === graceDeadline
    settings.mockResolvedValue({ streakGracePeriodHours: 2 });
    twoDaysAgo();

    await evaluateStreak('c1', 'f1');
    expect(writtenStreak()).toBe(6);
  });

  it('RESETS one minute past the deadline', async () => {
    freeze('2026-07-24T02:01:00Z'); // just past 02:00
    settings.mockResolvedValue({ streakGracePeriodHours: 2 });
    twoDaysAgo();

    await evaluateStreak('c1', 'f1');
    expect(writtenStreak()).toBe(1);
  });

  it('does not apply grace to a three-day gap even inside the window', async () => {
    freeze('2026-07-24T01:00:00Z');
    settings.mockResolvedValue({ streakGracePeriodHours: 6 });
    profile({ currentStreakDays: 5, lastActivityDate: daysAgo(3) }); // daysSinceLast === 3

    await evaluateStreak('c1', 'f1');
    expect(writtenStreak()).toBe(1);
  });

  it('treats a missing FamilySettings row as zero grace', async () => {
    freeze('2026-07-24T01:00:00Z');
    settings.mockResolvedValue(null); // no settings → gracePeriodHours defaults to 0
    profile({ currentStreakDays: 5, lastActivityDate: daysAgo(2) });

    await evaluateStreak('c1', 'f1');
    expect(writtenStreak()).toBe(1); // no grace → reset
  });
});

describe('isStreakAtRisk — same boundary, read-only', () => {
  it('is not at risk when a task was already completed today', async () => {
    freeze('2026-07-24T20:00:00Z');
    settings.mockResolvedValue({ streakGracePeriodHours: 2 });
    findProfile.mockResolvedValue({ currentStreakDays: 5, lastActivityDate: daysAgo(0) });

    expect(await isStreakAtRisk('c1', 'f1')).toBe(false);
  });

  it('is NOT yet at risk while still inside the grace window', async () => {
    freeze('2026-07-24T01:30:00Z'); // before the 02:00 deadline
    settings.mockResolvedValue({ streakGracePeriodHours: 2 });
    findProfile.mockResolvedValue({ currentStreakDays: 5, lastActivityDate: daysAgo(1) });

    expect(await isStreakAtRisk('c1', 'f1')).toBe(false);
  });

  it('IS at risk once the grace window has passed', async () => {
    freeze('2026-07-24T03:00:00Z'); // after the 02:00 deadline
    settings.mockResolvedValue({ streakGracePeriodHours: 2 });
    findProfile.mockResolvedValue({ currentStreakDays: 5, lastActivityDate: daysAgo(1) });

    expect(await isStreakAtRisk('c1', 'f1')).toBe(true);
  });

  it('is at risk immediately when there is no grace period', async () => {
    freeze('2026-07-24T00:30:00Z');
    settings.mockResolvedValue({ streakGracePeriodHours: 0 });
    findProfile.mockResolvedValue({ currentStreakDays: 5, lastActivityDate: daysAgo(1) });

    expect(await isStreakAtRisk('c1', 'f1')).toBe(true);
  });

  it('is not at risk for a child with no active streak', async () => {
    freeze('2026-07-24T09:00:00Z');
    settings.mockResolvedValue({ streakGracePeriodHours: 2 });
    findProfile.mockResolvedValue({ currentStreakDays: 0, lastActivityDate: daysAgo(3) });

    expect(await isStreakAtRisk('c1', 'f1')).toBe(false);
  });
});
