/**
 * U12 — the monthly report card (growth roadmap §5.4).
 *
 * This is the only artefact in the product designed to LEAVE it: a parent forwards it to a co-parent
 * or a grandparent, and it does the introducing. That shapes what the tests defend —
 *
 *  - an empty month must still render a real page, because a parent who shares a blank sheet is let
 *    down twice, once privately and once in front of whoever they sent it to;
 *  - a first-ever card must not invent a comparison against a month that never existed;
 *  - the month parameter is bounded, so a typo cannot become a table scan.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findFirst: jest.fn() },
    taskAssignment: { findMany: jest.fn(), count: jest.fn() },
    pointsLedger: { aggregate: jest.fn() },
    childAchievement: { findMany: jest.fn() },
  },
}));

import { ReportCardService, parseMonth } from '../src/services/ReportCardService';
import { exportReportCardPdf } from '../src/services/ExportService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  user: { findFirst: jest.Mock };
  taskAssignment: { findMany: jest.Mock; count: jest.Mock };
  pointsLedger: { aggregate: jest.Mock };
  childAchievement: { findMany: jest.Mock };
};

const FAMILY = 'fam-1';
const CHILD = 'child-1';

beforeEach(() => {
  jest.clearAllMocks();
  p.user.findFirst.mockResolvedValue({
    id: CHILD,
    firstName: 'Emma',
    childProfile: { currentStreakDays: 4, longestStreakDays: 11 },
  });
  p.taskAssignment.findMany.mockResolvedValue([]);
  p.taskAssignment.count.mockResolvedValue(0);
  p.pointsLedger.aggregate.mockResolvedValue({ _sum: { pointsAmount: 0 } });
  p.childAchievement.findMany.mockResolvedValue([]);
});

// ─── AC-U12f: the month parameter ─────────────────────────────────────────────

describe('parseMonth', () => {
  it('accepts a well-formed month', () => {
    expect(parseMonth('2026-07').toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('rejects a malformed string', () => {
    expect(() => parseMonth('July 2026')).toThrow(/YYYY-MM/);
    expect(() => parseMonth('2026-7')).toThrow(/YYYY-MM/);
  });

  it('rejects an impossible month number', () => {
    expect(() => parseMonth('2026-13')).toThrow(/between 01 and 12/);
    expect(() => parseMonth('2026-00')).toThrow(/between 01 and 12/);
  });

  it('rejects an absurd year, so a typo cannot become a table scan', () => {
    expect(() => parseMonth('0202-07')).toThrow(/out of range/);
    expect(() => parseMonth('9999-07')).toThrow(/out of range/);
  });
});

// ─── The card ─────────────────────────────────────────────────────────────────

describe('buildReportCard', () => {
  it('summarises the month', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      { approvedAt: new Date('2026-07-03T10:00:00Z') },
      { approvedAt: new Date('2026-07-03T14:00:00Z') },
      { approvedAt: new Date('2026-07-09T10:00:00Z') },
    ]);
    p.pointsLedger.aggregate.mockResolvedValue({ _sum: { pointsAmount: 140 } });
    p.childAchievement.findMany.mockResolvedValue([
      { achievement: { name: 'First Week' } },
      { achievement: { name: 'Tidy Champion' } },
    ]);

    const card = await ReportCardService.buildReportCard({
      familyId: FAMILY, childId: CHILD, month: '2026-07',
    });

    expect(card).toMatchObject({
      childName: 'Emma',
      monthLabel: 'July 2026',
      tasksApproved: 3,
      pointsEarned: 140,
      currentStreak: 4,
      longestStreak: 11,
      achievements: ['First Week', 'Tidy Champion'],
      isEmpty: false,
    });
  });

  it('finds the best day from the approvals already fetched', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      { approvedAt: new Date('2026-07-03T10:00:00Z') },
      { approvedAt: new Date('2026-07-03T14:00:00Z') },
      { approvedAt: new Date('2026-07-09T10:00:00Z') },
    ]);

    const card = await ReportCardService.buildReportCard({
      familyId: FAMILY, childId: CHILD, month: '2026-07',
    });

    expect(card.bestDay).toEqual({ date: '2026-07-03', approved: 2 });
  });

  it('has no best day for a month with no approvals', async () => {
    const card = await ReportCardService.buildReportCard({
      familyId: FAMILY, childId: CHILD, month: '2026-07',
    });
    expect(card.bestDay).toBeNull();
  });

  // AC-U12c — the property that stops a first card lying.
  it('reports NO delta when there is no prior month on record', async () => {
    p.taskAssignment.findMany.mockResolvedValue([{ approvedAt: new Date('2026-07-03T10:00:00Z') }]);
    p.taskAssignment.count.mockResolvedValue(0); // nothing last month

    const card = await ReportCardService.buildReportCard({
      familyId: FAMILY, childId: CHILD, month: '2026-07',
    });

    expect(card.previousMonthApproved).toBeNull();
    expect(card.approvedDelta).toBeNull();
  });

  it('reports a delta when last month had activity', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      { approvedAt: new Date('2026-07-03T10:00:00Z') },
      { approvedAt: new Date('2026-07-04T10:00:00Z') },
      { approvedAt: new Date('2026-07-05T10:00:00Z') },
    ]);
    p.taskAssignment.count.mockResolvedValue(7);

    const card = await ReportCardService.buildReportCard({
      familyId: FAMILY, childId: CHILD, month: '2026-07',
    });

    expect(card.previousMonthApproved).toBe(7);
    expect(card.approvedDelta).toBe(-4); // a worse month is still reported
  });

  it('queries the previous month as the month BEFORE the one requested', async () => {
    await ReportCardService.buildReportCard({ familyId: FAMILY, childId: CHILD, month: '2026-01' });

    const where = p.taskAssignment.count.mock.calls[0][0].where;
    expect(where.approvedAt.gte.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(where.approvedAt.lt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('flags an entirely empty month', async () => {
    const card = await ReportCardService.buildReportCard({
      familyId: FAMILY, childId: CHILD, month: '2026-07',
    });
    expect(card.isEmpty).toBe(true);
  });

  // AC-U12d
  it('404s for a child outside the family', async () => {
    p.user.findFirst.mockResolvedValue(null);
    await expect(
      ReportCardService.buildReportCard({ familyId: FAMILY, childId: 'other', month: '2026-07' }),
    ).rejects.toThrow(/not found/i);
  });

  it('scopes the child lookup to the family', async () => {
    await ReportCardService.buildReportCard({ familyId: FAMILY, childId: CHILD, month: '2026-07' });
    expect(p.user.findFirst.mock.calls[0][0].where.familyId).toBe(FAMILY);
  });
});

// ─── AC-U12a / AC-U12e: the rendered PDF ──────────────────────────────────────

describe('exportReportCardPdf', () => {
  const base = {
    childName: 'Emma',
    monthLabel: 'July 2026',
    tasksApproved: 12,
    pointsEarned: 340,
    currentStreak: 4,
    longestStreak: 11,
    achievements: ['First Week'],
    bestDay: { date: '2026-07-03', approved: 4 },
    previousMonthApproved: 8,
    approvedDelta: 4,
    isEmpty: false,
  };

  it('produces a real PDF', async () => {
    const buf = await exportReportCardPdf(base);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  // The property that matters for a document meant to be forwarded.
  it('produces a VALID PDF for an empty month, not a blank or an error', async () => {
    const buf = await exportReportCardPdf({
      ...base,
      tasksApproved: 0,
      pointsEarned: 0,
      achievements: [],
      bestDay: null,
      previousMonthApproved: null,
      approvedDelta: null,
      isEmpty: true,
    });

    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(500);
  });

  it('renders without a delta section when there is no prior month', async () => {
    const buf = await exportReportCardPdf({
      ...base, previousMonthApproved: null, approvedDelta: null,
    });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders a month with no achievements', async () => {
    const buf = await exportReportCardPdf({ ...base, achievements: [], bestDay: null });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
