/**
 * services/CalendarService.ts — the family week (growth roadmap §5.3).
 *
 * Read-only by design, per the roadmap's own guidance. Drag-to-reschedule is a much larger problem —
 * recurrence expansion, conflict re-checking, undo — and shipping a week people actually look at is
 * how you find out whether the drag is even wanted.
 *
 * Monday-start, UTC, matching the digest and the insights heatmap. Being consistently UTC across
 * every date surface is worth more than being locally right on one of them.
 */

import { prisma } from './database';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';

export interface CalendarEntry {
  assignmentId: string;
  taskId: string;
  title: string;
  status: string;
  /** ISO instant, or null. Most assignments have no time — see `isTimed`. */
  startTime: string | null;
  estimatedMinutes: number | null;
  /** False when the task has no start time. A calendar must not invent one. */
  isTimed: boolean;
  pointsValue: number;
  /** True when this entry's window overlaps another for the same child on the same day. */
  overlaps: boolean;
}

export interface CalendarDay {
  /** YYYY-MM-DD, UTC. */
  date: string;
  entries: CalendarEntry[];
}

export interface CalendarChild {
  childId: string;
  firstName: string;
  days: CalendarDay[];
}

export interface CalendarWeek {
  weekStart: string;
  weekEnd: string;
  /** YYYY-MM-DD for each of the seven days, Monday first. */
  dates: string[];
  children: CalendarChild[];
}

/** Monday 00:00 UTC of the week containing `date`. */
export function weekStartUtc(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Do two entries share any minute of the day?
 *
 * Mirrors the interval test in `utils/overlapCheck` deliberately rather than importing it: that
 * helper queries the database per child per task, which is the wrong shape for a week already loaded
 * into memory. The RULE is the same — touching endpoints do not overlap — so the calendar cannot
 * disagree with the warning modal a parent saw at creation time.
 */
export function entriesOverlap(
  a: { startTime: string | null; estimatedMinutes: number | null },
  b: { startTime: string | null; estimatedMinutes: number | null },
): boolean {
  if (!a.startTime || !b.startTime) return false; // an untimed task cannot clash with anything

  const aStart = new Date(a.startTime).getTime();
  const bStart = new Date(b.startTime).getTime();
  const aEnd = aStart + (a.estimatedMinutes ?? 30) * 60_000;
  const bEnd = bStart + (b.estimatedMinutes ?? 30) * 60_000;

  // Strict: a task ending exactly when the next begins is back-to-back, not a clash.
  return aStart < bEnd && bStart < aEnd;
}

/** Mark every entry in a day that clashes with another. O(n²) over a single child-day — tiny. */
export function markOverlaps(entries: CalendarEntry[]): void {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entriesOverlap(entries[i], entries[j])) {
        entries[i].overlaps = true;
        entries[j].overlaps = true;
      }
    }
  }
}

export async function getWeek(params: {
  familyId: string;
  /** Any date in the desired week, YYYY-MM-DD. Defaults to this week. */
  date?: string;
}): Promise<CalendarWeek> {
  let anchor = new Date();
  if (params.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
      throw new ValidationError('date must be in YYYY-MM-DD format.');
    }
    anchor = new Date(`${params.date}T00:00:00.000Z`);
    if (Number.isNaN(anchor.getTime())) throw new ValidationError('date is not a real date.');
  }

  const weekStart = weekStartUtc(anchor);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  const children = await prisma.user.findMany({
    where: { familyId: params.familyId, role: 'child', deletedAt: null },
    select: { id: true, firstName: true },
    orderBy: { firstName: 'asc' },
  });
  if (children.length === 0) {
    // Not an error — a family that has not added a child yet still gets a valid empty week.
    return {
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      dates: buildDates(weekStart),
      children: [],
    };
  }

  const assignments = await prisma.taskAssignment.findMany({
    where: {
      childId: { in: children.map((c) => c.id) },
      instanceDate: { gte: weekStart, lt: weekEnd },
      task: { familyId: params.familyId, deletedAt: null },
    },
    include: {
      task: {
        select: { id: true, title: true, startTime: true, estimatedMinutes: true, pointsValue: true },
      },
    },
  });

  const dates = buildDates(weekStart);

  const byChild = new Map<string, Map<string, CalendarEntry[]>>();
  for (const child of children) {
    byChild.set(child.id, new Map(dates.map((d) => [d, []])));
  }

  for (const a of assignments) {
    const dayMap = byChild.get(a.childId);
    if (!dayMap) continue;
    const key = dateKey(a.instanceDate);
    const bucket = dayMap.get(key);
    if (!bucket) continue; // outside the week after normalisation — skip rather than guess

    bucket.push({
      assignmentId: a.id,
      taskId: a.task.id,
      title: a.task.title,
      status: a.status,
      startTime: a.task.startTime ? a.task.startTime.toISOString() : null,
      estimatedMinutes: a.task.estimatedMinutes,
      isTimed: Boolean(a.task.startTime),
      pointsValue: a.task.pointsValue,
      overlaps: false,
    });
  }

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    dates,
    children: children.map((child) => {
      const dayMap = byChild.get(child.id)!;
      return {
        childId: child.id,
        firstName: child.firstName,
        days: dates.map((date) => {
          const entries = dayMap.get(date)!;
          // Timed first, in clock order; untimed after, since they have no position in the day.
          entries.sort((x, y) => {
            if (x.isTimed && y.isTimed) return x.startTime!.localeCompare(y.startTime!);
            if (x.isTimed) return -1;
            if (y.isTimed) return 1;
            return x.title.localeCompare(y.title);
          });
          markOverlaps(entries);
          return { date, entries };
        }),
      };
    }),
  };
}

/** The seven YYYY-MM-DD keys of a week, Monday first. */
function buildDates(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    return dateKey(d);
  });
}

export const CalendarService = { getWeek, weekStartUtc, entriesOverlap, markOverlaps };
