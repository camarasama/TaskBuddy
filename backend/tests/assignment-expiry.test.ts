// Pin the timezone before anything imports date-using code. `instanceDate` is a DATE column that
// Prisma hands back as midnight UTC, and expireOverdueAssignments buckets `now` into a UTC day — so
// a CI runner sitting in UTC+13 would otherwise disagree with a dev box about which day "yesterday"
// is. UTC makes the boundary rows reproducible everywhere.
process.env.TZ = 'UTC';

/**
 * U1 — assignments must actually expire.
 *
 * Before this, the expiry cron only ever set `emailSentAt`: it told the parents and left the row
 * `pending` forever. So a daily recurring task piled up one stale instance per elapsed day, and the
 * pool-task `status !== 'expired'` checks in taskSelfAssign.ts / tasks.ts could never free a
 * claim slot, because nothing in the codebase wrote that value.
 *
 * The properties defended here are the ones that would silently destroy a child's work if they
 * regressed:
 *  - the judgement is on `instanceDate`, so today's instance of a recurring task is safe even
 *    though it shares the parent's long-past dueDate;
 *  - finished states (completed / approved / rejected) are never rewritten;
 *  - the family's `streakGracePeriodHours` genuinely delays expiry rather than being read and
 *    ignored.
 *
 * The fake prisma below applies the real where-clauses to a seeded row set rather than just
 * recording calls, so these assert behaviour and not query shape.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    taskAssignment: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    familySettings: { findMany: jest.fn() },
  },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { sendToFamilyParents: jest.fn().mockResolvedValue(undefined) },
}));

import { expireOverdueAssignments } from '../src/jobs/expiryEmailCron';
import { prisma } from '../src/services/database';

const findMany = prisma.taskAssignment.findMany as jest.Mock;
const updateMany = prisma.taskAssignment.updateMany as jest.Mock;
const familySettings = prisma.familySettings.findMany as jest.Mock;

const FAMILY = 'fam-1';

type Row = { id: string; instanceDate: Date; status: string; familyId: string };

let rows: Row[] = [];

/** A DATE column value: midnight UTC on the given day, N days before the frozen "today". */
const dayUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const TODAY = '2026-08-04';
const YESTERDAY = '2026-08-03';
const LAST_WEEK = '2026-07-28';

function seed(...seeded: Array<Partial<Row> & { id: string; instanceDate: Date }>) {
  rows = seeded.map((r) => ({ status: 'pending', familyId: FAMILY, ...r }));
}

const statusOf = (id: string) => rows.find((r) => r.id === id)!.status;

beforeEach(() => {
  jest.clearAllMocks();
  rows = [];

  // Honour the same predicates Postgres would: status membership and the instanceDate upper bound.
  findMany.mockImplementation(async ({ where }: any) =>
    rows
      .filter(
        (r) =>
          where.status.in.includes(r.status) &&
          r.instanceDate.getTime() < where.instanceDate.lt.getTime(),
      )
      .map((r) => ({ id: r.id, instanceDate: r.instanceDate, task: { familyId: r.familyId } })),
  );

  updateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0;
    for (const r of rows) {
      if (where.id.in.includes(r.id) && where.status.in.includes(r.status)) {
        r.status = data.status;
        count += 1;
      }
    }
    return { count };
  });

  familySettings.mockResolvedValue([{ familyId: FAMILY, streakGracePeriodHours: 0 }]);
});

// ─── The core rule: your own day has to have passed ──────────────────────────

describe('expireOverdueAssignments — the day boundary', () => {
  it("expires yesterday's instance once the grace has elapsed", async () => {
    seed({ id: 'a1', instanceDate: dayUtc(YESTERDAY) });

    const count = await expireOverdueAssignments(new Date(`${TODAY}T00:05:00Z`));

    expect(count).toBe(1);
    expect(statusOf('a1')).toBe('expired');
  });

  it("leaves today's instance alone — this is the recurring-task duplicate bug", async () => {
    // The parent task's dueDate is long past for every instance of a daily recurrence. Judging on
    // dueDate would expire the instance the child is meant to be doing right now.
    seed({ id: 'a1', instanceDate: dayUtc(TODAY) });

    const count = await expireOverdueAssignments(new Date(`${TODAY}T23:59:00Z`));

    expect(count).toBe(0);
    expect(statusOf('a1')).toBe('pending');
  });

  it('expires an in_progress instance too — started is not finished', async () => {
    seed({ id: 'a1', instanceDate: dayUtc(YESTERDAY), status: 'in_progress' });

    await expireOverdueAssignments(new Date(`${TODAY}T00:05:00Z`));

    expect(statusOf('a1')).toBe('expired');
  });

  it('sweeps a whole backlog of stale recurring instances in one run', async () => {
    seed(
      { id: 'mon', instanceDate: dayUtc('2026-08-01') },
      { id: 'tue', instanceDate: dayUtc('2026-08-02') },
      { id: 'wed', instanceDate: dayUtc(YESTERDAY) },
      { id: 'today', instanceDate: dayUtc(TODAY) },
    );

    const count = await expireOverdueAssignments(new Date(`${TODAY}T00:05:00Z`));

    expect(count).toBe(3);
    expect(statusOf('today')).toBe('pending');
  });
});

// ─── Finished work is never rewritten ────────────────────────────────────────

describe('expireOverdueAssignments — terminal states are untouchable', () => {
  it('never expires a completed row, however old', async () => {
    // Expiring this would strip points the child has already been paid.
    seed({ id: 'a1', instanceDate: dayUtc(LAST_WEEK), status: 'completed' });

    const count = await expireOverdueAssignments(new Date(`${TODAY}T00:05:00Z`));

    expect(count).toBe(0);
    expect(statusOf('a1')).toBe('completed');
  });

  it('never expires an approved row, however old', async () => {
    seed({ id: 'a1', instanceDate: dayUtc(LAST_WEEK), status: 'approved' });

    await expireOverdueAssignments(new Date(`${TODAY}T00:05:00Z`));

    expect(statusOf('a1')).toBe('approved');
  });

  it('never expires a rejected row — that verdict has a reason attached to it', async () => {
    seed({ id: 'a1', instanceDate: dayUtc(LAST_WEEK), status: 'rejected' });

    await expireOverdueAssignments(new Date(`${TODAY}T00:05:00Z`));

    expect(statusOf('a1')).toBe('rejected');
  });

  it('re-asserts the status filter on the WRITE, not just the read', async () => {
    // Guards the race where a child submits between the SELECT and the UPDATE.
    seed({ id: 'a1', instanceDate: dayUtc(YESTERDAY) });

    await expireOverdueAssignments(new Date(`${TODAY}T00:05:00Z`));

    expect(updateMany.mock.calls[0][0].where.status.in).toEqual(['pending', 'in_progress']);
  });
});

// ─── The grace period is honoured, not merely read ───────────────────────────

describe('expireOverdueAssignments — streakGracePeriodHours', () => {
  it('does NOT expire yesterday at 06:00 when the family has a 12h grace', async () => {
    familySettings.mockResolvedValue([{ familyId: FAMILY, streakGracePeriodHours: 12 }]);
    seed({ id: 'a1', instanceDate: dayUtc(YESTERDAY) });

    const count = await expireOverdueAssignments(new Date(`${TODAY}T06:00:00Z`));

    expect(count).toBe(0);
    expect(statusOf('a1')).toBe('pending');
  });

  it('expires the same row once that 12h window has closed', async () => {
    // Pairs with the test above: proves grace delays expiry rather than preventing it.
    familySettings.mockResolvedValue([{ familyId: FAMILY, streakGracePeriodHours: 12 }]);
    seed({ id: 'a1', instanceDate: dayUtc(YESTERDAY) });

    const count = await expireOverdueAssignments(new Date(`${TODAY}T12:01:00Z`));

    expect(count).toBe(1);
    expect(statusOf('a1')).toBe('expired');
  });

  it('treats a missing FamilySettings row as zero grace', async () => {
    // Matches streakService's `?? 0` fallback so the two features cannot disagree about a family.
    familySettings.mockResolvedValue([]);
    seed({ id: 'a1', instanceDate: dayUtc(YESTERDAY) });

    expect(await expireOverdueAssignments(new Date(`${TODAY}T00:05:00Z`))).toBe(1);
  });

  it('applies each family its own grace in the same run', async () => {
    familySettings.mockResolvedValue([
      { familyId: FAMILY, streakGracePeriodHours: 0 },
      { familyId: 'fam-2', streakGracePeriodHours: 12 },
    ]);
    seed(
      { id: 'strict', instanceDate: dayUtc(YESTERDAY), familyId: FAMILY },
      { id: 'lenient', instanceDate: dayUtc(YESTERDAY), familyId: 'fam-2' },
    );

    await expireOverdueAssignments(new Date(`${TODAY}T06:00:00Z`));

    expect(statusOf('strict')).toBe('expired');
    expect(statusOf('lenient')).toBe('pending');
  });
});

// ─── Housekeeping ────────────────────────────────────────────────────────────

describe('expireOverdueAssignments — no work to do', () => {
  it('returns 0 and issues no write when nothing is overdue', async () => {
    seed({ id: 'a1', instanceDate: dayUtc(TODAY) });

    expect(await expireOverdueAssignments(new Date(`${TODAY}T09:00:00Z`))).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(familySettings).not.toHaveBeenCalled();
  });
});
