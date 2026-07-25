/**
 * U10 — insights + consistency heatmap (growth roadmap §5.2).
 *
 * The roadmap calls the heatmap the single most persuasive "this is working" visual, and the failure
 * mode is subtle: a SPARSE series looks fine in a JSON response and renders as a lie, because the
 * empty days are the entire signal a parent reads. Hence `buildDenseHeatmap` is pure and tested
 * directly.
 *
 * The inflation warning is the other thing worth defending: a stated threshold that can be argued
 * with, and that stays quiet for a family with too little data rather than telling a two-day-old
 * account its economy is broken.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    taskAssignment: { findMany: jest.fn() },
    pointsLedger: { findMany: jest.fn() },
    childProfile: { findMany: jest.fn() },
  },
}));

import {
  INFLATION_MIN_EARNED,
  INFLATION_RATIO,
  InsightsService,
  buildDenseHeatmap,
  inflationWarning,
} from '../src/services/InsightsService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  taskAssignment: { findMany: jest.Mock };
  pointsLedger: { findMany: jest.Mock };
  childProfile: { findMany: jest.Mock };
};

const FAMILY = 'fam-1';

beforeEach(() => {
  jest.clearAllMocks();
  p.taskAssignment.findMany.mockResolvedValue([]);
  p.pointsLedger.findMany.mockResolvedValue([]);
  p.childProfile.findMany.mockResolvedValue([]);
});

// ─── AC-U10a: the dense series ────────────────────────────────────────────────

describe('buildDenseHeatmap', () => {
  it('includes EVERY day in the window, zeroes included', () => {
    // A sparse series would make the front end invent the gaps — and the gaps are the signal.
    const days = buildDenseHeatmap(
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-07T00:00:00Z'),
      new Map(),
    );
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.approved === 0)).toBe(true);
  });

  it('has no holes when only some days have activity', () => {
    const days = buildDenseHeatmap(
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-05T00:00:00Z'),
      new Map([['2026-07-03', 4]]),
    );
    expect(days.map((d) => d.date)).toEqual([
      '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05',
    ]);
    expect(days.find((d) => d.date === '2026-07-03')!.approved).toBe(4);
  });

  it('is ordered oldest-first', () => {
    const days = buildDenseHeatmap(
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-04T00:00:00Z'),
      new Map(),
    );
    expect(days[0].date < days[days.length - 1].date).toBe(true);
  });

  it('handles a single-day window', () => {
    const days = buildDenseHeatmap(
      new Date('2026-07-01T12:00:00Z'),
      new Date('2026-07-01T18:00:00Z'),
      new Map(),
    );
    expect(days).toHaveLength(1);
  });

  it('normalises to UTC midnight, so a time-of-day does not create two entries', () => {
    const days = buildDenseHeatmap(
      new Date('2026-07-01T23:30:00Z'),
      new Date('2026-07-02T00:30:00Z'),
      new Map(),
    );
    expect(days.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-02']);
  });
});

// ─── AC-U10e: the inflation warning ───────────────────────────────────────────

describe('inflationWarning', () => {
  it('stays SILENT for a family with too little data', () => {
    // Telling a two-day-old account its economy is broken would be wrong and rude.
    expect(inflationWarning(INFLATION_MIN_EARNED - 1, 0)).toBeNull();
  });

  it('warns when plenty has been earned and nothing spent', () => {
    const warning = inflationWarning(500, 0);
    expect(warning).toMatch(/none spent/i);
  });

  it('warns when earning outpaces spending past the threshold', () => {
    const warning = inflationWarning(900, 100); // 9x
    expect(warning).toMatch(/faster than they are spent/i);
  });

  it('stays silent for a healthy economy', () => {
    expect(inflationWarning(400, 300)).toBeNull();
  });

  it('is quiet exactly at the threshold boundary minus one', () => {
    const spent = 100;
    expect(inflationWarning(spent * INFLATION_RATIO - 1, spent)).toBeNull();
  });

  it('fires exactly at the threshold', () => {
    const spent = 100;
    expect(inflationWarning(spent * INFLATION_RATIO, spent)).not.toBeNull();
  });
});

// ─── The assembled report ─────────────────────────────────────────────────────

describe('getInsights', () => {
  it('buckets day-of-week with Monday at index 0', async () => {
    // 2026-07-06 is a Monday; 2026-07-12 is a Sunday.
    p.taskAssignment.findMany.mockResolvedValue([
      { approvedAt: new Date('2026-07-06T10:00:00Z'), completedAt: null },
      { approvedAt: new Date('2026-07-12T10:00:00Z'), completedAt: null },
    ]);

    const report = await InsightsService.getInsights({ familyId: FAMILY, weeks: 52 });

    expect(report.byDayOfWeek[0]).toBe(1); // Monday
    expect(report.byDayOfWeek[6]).toBe(1); // Sunday
  });

  it('buckets hour-of-day on when the CHILD finished, not when the parent approved', async () => {
    // Otherwise approval latency smears every child's working hours into the evening.
    p.taskAssignment.findMany.mockResolvedValue([
      {
        completedAt: new Date('2026-07-06T07:00:00Z'),
        approvedAt: new Date('2026-07-06T21:00:00Z'),
      },
    ]);

    const report = await InsightsService.getInsights({ familyId: FAMILY, weeks: 52 });

    expect(report.byHourOfDay[7]).toBe(1);
    expect(report.byHourOfDay[21]).toBe(0);
  });

  it('falls back to the approval time when nothing recorded a completion', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      { completedAt: null, approvedAt: new Date('2026-07-06T15:00:00Z') },
    ]);
    const report = await InsightsService.getInsights({ familyId: FAMILY, weeks: 52 });
    expect(report.byHourOfDay[15]).toBe(1);
  });

  it('splits the ledger into earned and spent on sign', async () => {
    p.pointsLedger.findMany.mockResolvedValue([
      { pointsAmount: 100 },
      { pointsAmount: 50 },
      { pointsAmount: -30 },
    ]);

    const report = await InsightsService.getInsights({ familyId: FAMILY });

    expect(report.economy.pointsEarned).toBe(150);
    expect(report.economy.pointsSpent).toBe(30);
    expect(report.economy.earnSpendRatio).toBe(5);
  });

  it('returns a NULL ratio rather than an infinity when nothing was spent', async () => {
    p.pointsLedger.findMany.mockResolvedValue([{ pointsAmount: 100 }]);
    const report = await InsightsService.getInsights({ familyId: FAMILY });
    expect(report.economy.earnSpendRatio).toBeNull();
  });

  it('sums current balances across the family', async () => {
    p.childProfile.findMany.mockResolvedValue([{ pointsBalance: 120 }, { pointsBalance: 80 }]);
    const report = await InsightsService.getInsights({ familyId: FAMILY });
    expect(report.economy.currentBalance).toBe(200);
  });

  it('counts active days from the dense series', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      { approvedAt: new Date(), completedAt: null },
      { approvedAt: new Date(), completedAt: null },
    ]);
    const report = await InsightsService.getInsights({ familyId: FAMILY, weeks: 1 });
    expect(report.totals.approved).toBe(2);
    expect(report.totals.activeDays).toBe(1); // both on the same day
  });

  // AC-U10g
  it('returns a dense zero series and null ratios for an empty window', async () => {
    const report = await InsightsService.getInsights({ familyId: FAMILY, weeks: 2 });

    expect(report.heatmap.length).toBeGreaterThan(13);
    expect(report.heatmap.every((d) => d.approved === 0)).toBe(true);
    expect(report.economy.earnSpendRatio).toBeNull();
    expect(report.economy.inflationWarning).toBeNull();
    expect(report.totals).toEqual({ approved: 0, activeDays: 0 });
  });

  // AC-U10f
  it('scopes every query to the family', async () => {
    await InsightsService.getInsights({ familyId: FAMILY });

    expect(p.taskAssignment.findMany.mock.calls[0][0].where.task.familyId).toBe(FAMILY);
    expect(p.pointsLedger.findMany.mock.calls[0][0].where.child.familyId).toBe(FAMILY);
  });

  it('filters to one child when asked', async () => {
    await InsightsService.getInsights({ familyId: FAMILY, childId: 'child-1' });
    expect(p.taskAssignment.findMany.mock.calls[0][0].where.childId).toBe('child-1');
  });

  it('clamps an absurd window rather than scanning years', async () => {
    const report = await InsightsService.getInsights({ familyId: FAMILY, weeks: 9999 });
    expect(report.window.weeks).toBe(52);
  });

  it('clamps a zero or negative window to at least one week', async () => {
    const report = await InsightsService.getInsights({ familyId: FAMILY, weeks: 0 });
    expect(report.window.weeks).toBe(1);
  });
});
