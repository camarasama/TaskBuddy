/**
 * U13 — the family calendar (growth roadmap §5.3). Read-only, per the roadmap's own guidance.
 *
 * Two properties are worth defending:
 *
 *  - **Untimed tasks stay untimed.** Most assignments have no `startTime`, and a calendar that
 *    invented 09:00 for them would be fabricating data a parent would then plan around.
 *  - **The overlap RULE matches FR-12's.** Touching endpoints are back-to-back, not a clash. If this
 *    diverged, the calendar would contradict the warning modal the parent saw when creating the task.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    taskAssignment: { findMany: jest.fn() },
  },
}));

import {
  CalendarService,
  entriesOverlap,
  markOverlaps,
  weekStartUtc,
  type CalendarEntry,
} from '../src/services/CalendarService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  user: { findMany: jest.Mock };
  taskAssignment: { findMany: jest.Mock };
};

const FAMILY = 'fam-1';

function entry(over: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    assignmentId: 'a1', taskId: 't1', title: 'Task', status: 'pending',
    startTime: null, estimatedMinutes: null, isTimed: false, pointsValue: 10,
    overlaps: false, ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.user.findMany.mockResolvedValue([{ id: 'c1', firstName: 'Emma' }]);
  p.taskAssignment.findMany.mockResolvedValue([]);
});

describe('weekStartUtc', () => {
  it('returns the Monday of the containing week', () => {
    // 2026-07-22 is a Wednesday.
    expect(weekStartUtc(new Date('2026-07-22T15:00:00Z')).toISOString()).toBe(
      '2026-07-20T00:00:00.000Z',
    );
  });

  it('treats Sunday as the END of its week, not the start', () => {
    // getUTCDay() is 0 on Sunday; the naive form jumps forward a week here.
    expect(weekStartUtc(new Date('2026-07-26T23:00:00Z')).toISOString()).toBe(
      '2026-07-20T00:00:00.000Z',
    );
  });

  it('is idempotent on a Monday', () => {
    const monday = new Date('2026-07-20T00:00:00Z');
    expect(weekStartUtc(monday).toISOString()).toBe(monday.toISOString());
  });
});

// ─── AC-U13d: the overlap rule ────────────────────────────────────────────────

describe('entriesOverlap', () => {
  it('detects a genuine clash', () => {
    expect(
      entriesOverlap(
        { startTime: '2026-07-20T09:00:00Z', estimatedMinutes: 60 },
        { startTime: '2026-07-20T09:30:00Z', estimatedMinutes: 30 },
      ),
    ).toBe(true);
  });

  it('treats touching endpoints as back-to-back, NOT a clash', () => {
    // Same rule as FR-12's warning modal — if this diverged, the calendar would contradict what the
    // parent was told at creation time.
    expect(
      entriesOverlap(
        { startTime: '2026-07-20T09:00:00Z', estimatedMinutes: 60 },
        { startTime: '2026-07-20T10:00:00Z', estimatedMinutes: 30 },
      ),
    ).toBe(false);
  });

  it('never clashes when either task is untimed', () => {
    expect(
      entriesOverlap(
        { startTime: null, estimatedMinutes: 60 },
        { startTime: '2026-07-20T09:00:00Z', estimatedMinutes: 60 },
      ),
    ).toBe(false);
  });

  it('assumes a default duration when none is recorded', () => {
    // Two timed tasks 10 minutes apart with no estimate should still read as a clash.
    expect(
      entriesOverlap(
        { startTime: '2026-07-20T09:00:00Z', estimatedMinutes: null },
        { startTime: '2026-07-20T09:10:00Z', estimatedMinutes: null },
      ),
    ).toBe(true);
  });
});

describe('markOverlaps', () => {
  it('flags BOTH sides of a clash', () => {
    const list = [
      entry({ assignmentId: 'a', startTime: '2026-07-20T09:00:00Z', estimatedMinutes: 60, isTimed: true }),
      entry({ assignmentId: 'b', startTime: '2026-07-20T09:30:00Z', estimatedMinutes: 30, isTimed: true }),
    ];
    markOverlaps(list);
    expect(list.every((e) => e.overlaps)).toBe(true);
  });

  it('leaves a lone entry unflagged', () => {
    const list = [entry({ startTime: '2026-07-20T09:00:00Z', isTimed: true })];
    markOverlaps(list);
    expect(list[0].overlaps).toBe(false);
  });

  it('leaves a day of untimed tasks unflagged', () => {
    const list = [entry({ assignmentId: 'a' }), entry({ assignmentId: 'b' })];
    markOverlaps(list);
    expect(list.some((e) => e.overlaps)).toBe(false);
  });
});

// ─── The assembled week ───────────────────────────────────────────────────────

describe('getWeek', () => {
  it('returns seven Monday-first dates', async () => {
    const week = await CalendarService.getWeek({ familyId: FAMILY, date: '2026-07-22' });
    expect(week.dates).toEqual([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23',
      '2026-07-24', '2026-07-25', '2026-07-26',
    ]);
  });

  it('gives every child all seven days, even empty ones', async () => {
    // AC-U13f: an empty week is a grid, not a hole.
    const week = await CalendarService.getWeek({ familyId: FAMILY, date: '2026-07-22' });
    expect(week.children[0].days).toHaveLength(7);
    expect(week.children[0].days.every((d) => d.entries.length === 0)).toBe(true);
  });

  it('places an assignment on its instance date', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      {
        id: 'a1', childId: 'c1', status: 'pending',
        instanceDate: new Date('2026-07-22T00:00:00Z'),
        task: { id: 't1', title: 'Tidy room', startTime: null, estimatedMinutes: null, pointsValue: 10 },
      },
    ]);

    const week = await CalendarService.getWeek({ familyId: FAMILY, date: '2026-07-22' });
    const wed = week.children[0].days.find((d) => d.date === '2026-07-22')!;
    expect(wed.entries[0]).toMatchObject({ title: 'Tidy room', isTimed: false, startTime: null });
  });

  // AC-U13c — the property that stops the calendar fabricating data.
  it('does NOT invent a time for an untimed task', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      {
        id: 'a1', childId: 'c1', status: 'pending',
        instanceDate: new Date('2026-07-22T00:00:00Z'),
        task: { id: 't1', title: 'Tidy room', startTime: null, estimatedMinutes: 30, pointsValue: 10 },
      },
    ]);

    const week = await CalendarService.getWeek({ familyId: FAMILY, date: '2026-07-22' });
    const entryOut = week.children[0].days.find((d) => d.date === '2026-07-22')!.entries[0];
    expect(entryOut.startTime).toBeNull();
    expect(entryOut.isTimed).toBe(false);
  });

  it('sorts timed tasks by clock, untimed after them', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      { id: 'a1', childId: 'c1', status: 'pending', instanceDate: new Date('2026-07-22T00:00:00Z'),
        task: { id: 't1', title: 'Untimed', startTime: null, estimatedMinutes: null, pointsValue: 5 } },
      { id: 'a2', childId: 'c1', status: 'pending', instanceDate: new Date('2026-07-22T00:00:00Z'),
        task: { id: 't2', title: 'Late', startTime: new Date('2026-07-22T17:00:00Z'), estimatedMinutes: 30, pointsValue: 5 } },
      { id: 'a3', childId: 'c1', status: 'pending', instanceDate: new Date('2026-07-22T00:00:00Z'),
        task: { id: 't3', title: 'Early', startTime: new Date('2026-07-22T07:00:00Z'), estimatedMinutes: 30, pointsValue: 5 } },
    ]);

    const week = await CalendarService.getWeek({ familyId: FAMILY, date: '2026-07-22' });
    const titles = week.children[0].days
      .find((d) => d.date === '2026-07-22')!
      .entries.map((e) => e.title);

    expect(titles).toEqual(['Early', 'Late', 'Untimed']);
  });

  it('flags overlapping entries within a child-day', async () => {
    p.taskAssignment.findMany.mockResolvedValue([
      { id: 'a1', childId: 'c1', status: 'pending', instanceDate: new Date('2026-07-22T00:00:00Z'),
        task: { id: 't1', title: 'A', startTime: new Date('2026-07-22T09:00:00Z'), estimatedMinutes: 60, pointsValue: 5 } },
      { id: 'a2', childId: 'c1', status: 'pending', instanceDate: new Date('2026-07-22T00:00:00Z'),
        task: { id: 't2', title: 'B', startTime: new Date('2026-07-22T09:30:00Z'), estimatedMinutes: 30, pointsValue: 5 } },
    ]);

    const week = await CalendarService.getWeek({ familyId: FAMILY, date: '2026-07-22' });
    const entries = week.children[0].days.find((d) => d.date === '2026-07-22')!.entries;
    expect(entries.every((e) => e.overlaps)).toBe(true);
  });

  it('does not cross-contaminate children', async () => {
    p.user.findMany.mockResolvedValue([
      { id: 'c1', firstName: 'Emma' },
      { id: 'c2', firstName: 'Kofi' },
    ]);
    p.taskAssignment.findMany.mockResolvedValue([
      { id: 'a1', childId: 'c1', status: 'pending', instanceDate: new Date('2026-07-22T00:00:00Z'),
        task: { id: 't1', title: 'Emma only', startTime: null, estimatedMinutes: null, pointsValue: 5 } },
    ]);

    const week = await CalendarService.getWeek({ familyId: FAMILY, date: '2026-07-22' });
    const kofi = week.children.find((c) => c.firstName === 'Kofi')!;
    expect(kofi.days.every((d) => d.entries.length === 0)).toBe(true);
  });

  // AC-U13e / AC-U13f
  it('scopes to the family', async () => {
    await CalendarService.getWeek({ familyId: FAMILY, date: '2026-07-22' });
    expect(p.user.findMany.mock.calls[0][0].where.familyId).toBe(FAMILY);
    expect(p.taskAssignment.findMany.mock.calls[0][0].where.task.familyId).toBe(FAMILY);
  });

  it('returns a valid empty week for a family with no children', async () => {
    p.user.findMany.mockResolvedValue([]);
    const week = await CalendarService.getWeek({ familyId: FAMILY, date: '2026-07-22' });
    expect(week.children).toEqual([]);
    expect(week.dates).toHaveLength(7);
  });

  // AC-U13b
  it('rejects a malformed date rather than 500ing on a stale bookmark', async () => {
    await expect(
      CalendarService.getWeek({ familyId: FAMILY, date: '22-07-2026' }),
    ).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('defaults to the current week when no date is given', async () => {
    const week = await CalendarService.getWeek({ familyId: FAMILY });
    expect(week.dates).toHaveLength(7);
    expect(new Date(week.weekStart).getUTCDay()).toBe(1); // Monday
  });
});
