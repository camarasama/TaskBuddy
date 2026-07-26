/**
 * U15 — R-12 games report and R-13 webhook deliveries report (growth roadmap §6).
 *
 * Both exist because a shipped feature had been running with no visibility at all:
 *
 *  - Games award real points, up to `maxGamePointsPerDay`, and appeared in no report. The per-child
 *    block is mostly there to answer "why did my child only get 10 points?" — the answer is nearly
 *    always the cap, which was displayed nowhere.
 *  - FR-18 auto-disables a webhook subscription after repeated failures and tells nobody durably.
 *
 * The single most important test in this file is the one asserting the signing secret cannot appear
 * in R-13's output. It greps the whole serialised report rather than checking a named key, so a
 * future field addition cannot leak it past a test that only knew about the fields of today.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    gameDefinition: { findMany: jest.fn() },
    gameSession: { findMany: jest.fn() },
    familySettings: { findUnique: jest.fn() },
    webhookSubscription: { findMany: jest.fn() },
  },
}));

import { getGamesReport, getWebhookReport } from '../src/services/ReportService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  user: { findMany: jest.Mock };
  gameDefinition: { findMany: jest.Mock };
  gameSession: { findMany: jest.Mock };
  familySettings: { findUnique: jest.Mock };
  webhookSubscription: { findMany: jest.Mock };
};

const FAMILY = 'fam-1';

/** Fixed "now" is irrelevant here; what matters is before/after UTC midnight. */
const TODAY = new Date();
TODAY.setUTCHours(9, 0, 0, 0);
const YESTERDAY = new Date(TODAY.getTime() - 24 * 3_600_000);

function session(over: Record<string, unknown> = {}) {
  return {
    gameDefinitionId: 'g1',
    childId: 'c1',
    status: 'completed',
    pointsAwarded: 10,
    submittedAt: TODAY,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.user.findMany.mockResolvedValue([{ id: 'c1', firstName: 'Emma', lastName: 'T' }]);
  p.gameDefinition.findMany.mockResolvedValue([
    { id: 'g1', title: 'Math Sprint', difficulty: 'easy' },
  ]);
  p.gameSession.findMany.mockResolvedValue([]);
  p.familySettings.findUnique.mockResolvedValue({ maxGamePointsPerDay: 100 });
  p.webhookSubscription.findMany.mockResolvedValue([]);
});

// ─── R-12 ─────────────────────────────────────────────────────────────────────

describe('R-12 games report', () => {
  it('counts plays, completions and points per game', async () => {
    p.gameSession.findMany.mockResolvedValue([
      session(),
      session({ status: 'expired', pointsAwarded: 0 }),
      session({ pointsAwarded: 20 }),
    ]);

    const report = await getGamesReport({ familyId: FAMILY });
    expect(report.games[0]).toMatchObject({
      title: 'Math Sprint',
      plays: 3,
      completions: 2,
      pointsAwardedTotal: 30,
    });
  });

  it('reports pass rate as a percentage', async () => {
    p.gameSession.findMany.mockResolvedValue([
      session(),
      session({ status: 'expired', pointsAwarded: 0 }),
    ]);
    expect((await getGamesReport({ familyId: FAMILY })).games[0].passRate).toBe(50);
  });

  it('leaves pass rate NULL for a game nobody has played', async () => {
    // 0% would read as "everyone fails at it", which is a different and wrong statement.
    const report = await getGamesReport({ familyId: FAMILY });
    expect(report.games[0].passRate).toBeNull();
    expect(report.games[0].plays).toBe(0);
  });

  it('averages points over completions, not over plays', async () => {
    // Abandoned sessions award nothing; dividing by them would understate what a game is worth.
    p.gameSession.findMany.mockResolvedValue([
      session({ pointsAwarded: 20 }),
      session({ status: 'expired', pointsAwarded: 0 }),
    ]);
    expect((await getGamesReport({ familyId: FAMILY })).games[0].averagePointsAwarded).toBe(20);
  });

  // AC-U15b — the reason the per-child block exists.
  it("surfaces today's points against the family cap", async () => {
    p.gameSession.findMany.mockResolvedValue([
      session({ pointsAwarded: 30, submittedAt: TODAY }),
      session({ pointsAwarded: 50, submittedAt: YESTERDAY }),
    ]);

    const child = (await getGamesReport({ familyId: FAMILY })).children[0];
    expect(child.pointsEarnedTotal).toBe(80);
    expect(child.pointsToday).toBe(30); // yesterday's 50 does not count against today
    expect(child.dailyCap).toBe(100);
    expect(child.atDailyCap).toBe(false);
  });

  it('flags a child who has hit the cap', async () => {
    p.familySettings.findUnique.mockResolvedValue({ maxGamePointsPerDay: 20 });
    p.gameSession.findMany.mockResolvedValue([session({ pointsAwarded: 20, submittedAt: TODAY })]);

    expect((await getGamesReport({ familyId: FAMILY })).children[0].atDailyCap).toBe(true);
  });

  it('falls back to the schema default when a family has no settings row', async () => {
    p.familySettings.findUnique.mockResolvedValue(null);
    expect((await getGamesReport({ familyId: FAMILY })).children[0].dailyCap).toBe(100);
  });

  // AC-U15d
  it('returns empty rows for a family that has never played', async () => {
    const report = await getGamesReport({ familyId: FAMILY });
    expect(report.totals).toEqual({ plays: 0, completions: 0, pointsAwarded: 0 });
    expect(report.children[0].plays).toBe(0);
  });

  it('returns an empty report for a family with no children', async () => {
    p.user.findMany.mockResolvedValue([]);
    expect(await getGamesReport({ familyId: FAMILY })).toEqual({
      games: [],
      children: [],
      totals: { plays: 0, completions: 0, pointsAwarded: 0 },
    });
  });

  // AC-U15c
  it('scopes children to the family', async () => {
    await getGamesReport({ familyId: FAMILY });
    expect(p.user.findMany.mock.calls[0][0].where).toMatchObject({
      familyId: FAMILY,
      role: 'child',
      deletedAt: null,
    });
  });

  it('narrows to one child when asked', async () => {
    await getGamesReport({ familyId: FAMILY, childId: 'c1' });
    expect(p.user.findMany.mock.calls[0][0].where.id).toBe('c1');
  });

  it('never queries across families when the scope is missing', async () => {
    // Without this guard the export path could reach the service unscoped and match every family's
    // children.
    const report = await getGamesReport({});
    expect(report.children).toEqual([]);
    expect(p.user.findMany).not.toHaveBeenCalled();
  });

  it('applies the date range to sessions', async () => {
    const start = new Date('2026-07-01T00:00:00Z');
    const end = new Date('2026-07-31T00:00:00Z');
    await getGamesReport({ familyId: FAMILY, startDate: start, endDate: end });
    expect(p.gameSession.findMany.mock.calls[0][0].where.submittedAt).toEqual({
      gte: start,
      lte: end,
    });
  });

  it('does not cross-contaminate children', async () => {
    p.user.findMany.mockResolvedValue([
      { id: 'c1', firstName: 'Emma', lastName: 'T' },
      { id: 'c2', firstName: 'Kofi', lastName: 'T' },
    ]);
    p.gameSession.findMany.mockResolvedValue([session({ childId: 'c1', pointsAwarded: 40 })]);

    const kofi = (await getGamesReport({ familyId: FAMILY })).children.find(
      (c) => c.childName === 'Kofi T',
    )!;
    expect(kofi).toMatchObject({ plays: 0, pointsEarnedTotal: 0, pointsToday: 0 });
  });
});

// ─── R-13 ─────────────────────────────────────────────────────────────────────

function subscription(over: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    url: 'https://hooks.example.com/taskbuddy',
    events: ['task.approved'],
    isActive: true,
    failureCount: 0,
    lastSuccessAt: new Date('2026-07-20T10:00:00Z'),
    lastFailureAt: null,
    disabledAt: null,
    recentFailures: [],
    ...over,
  };
}

describe('R-13 webhook deliveries report', () => {
  // AC-U15f — the test this whole report has to pass.
  it('cannot leak the signing secret, whatever shape the row takes', async () => {
    // Prisma is mocked, so it returns whatever we hand back — including a secret the real query
    // never selects. Serialising the WHOLE report and searching it means a future field addition
    // cannot quietly reintroduce the leak past a test that only knew today's field names.
    const SECRET = 'whsec_super_secret_value';
    p.webhookSubscription.findMany.mockResolvedValue([subscription({ secret: SECRET })]);

    const serialised = JSON.stringify(await getWebhookReport({ familyId: FAMILY }));
    expect(serialised).not.toContain(SECRET);
    expect(serialised.toLowerCase()).not.toContain('secret');
  });

  it('never even asks the database for the secret', async () => {
    // Defence in depth: the leak is prevented at the query, not by filtering afterwards.
    await getWebhookReport({ familyId: FAMILY });
    const select = p.webhookSubscription.findMany.mock.calls[0][0].select;
    expect(select.secret).toBeUndefined();
    expect(select.url).toBe(true);
  });

  // AC-U15e — the reason the report exists.
  it('surfaces an auto-disabled subscription', async () => {
    const disabledAt = new Date('2026-07-24T08:00:00Z');
    p.webhookSubscription.findMany.mockResolvedValue([
      subscription({ isActive: false, failureCount: 5, disabledAt, lastFailureAt: disabledAt }),
    ]);

    const report = await getWebhookReport({ familyId: FAMILY });
    expect(report.rows[0].disabledAt).toBe(disabledAt.toISOString());
    expect(report.rows[0].consecutiveFailures).toBe(5);
    expect(report.summary.autoDisabled).toBe(1);
  });

  it('counts a still-active but failing subscription separately from a disabled one', async () => {
    // That gap is the window in which a parent can still fix the integration before FR-18 kills it.
    p.webhookSubscription.findMany.mockResolvedValue([
      subscription({ id: 'w1', failureCount: 2 }),
      subscription({ id: 'w2', isActive: false, failureCount: 5, disabledAt: new Date() }),
      subscription({ id: 'w3' }),
    ]);

    const { summary } = await getWebhookReport({ familyId: FAMILY });
    expect(summary).toEqual({ total: 3, active: 2, autoDisabled: 1, failing: 1 });
  });

  // AC-U15g
  it('passes through the recent-failure ring buffer with its reasons', async () => {
    const failures = [
      { at: '2026-07-24T08:00:00Z', event: 'task.approved', reason: 'timeout', status: 0 },
      { at: '2026-07-23T08:00:00Z', event: 'task.approved', reason: 'HTTP 500', status: 500 },
    ];
    p.webhookSubscription.findMany.mockResolvedValue([subscription({ recentFailures: failures })]);

    expect((await getWebhookReport({ familyId: FAMILY })).rows[0].recentFailures).toEqual(failures);
  });

  it('tolerates a malformed ring buffer rather than throwing', async () => {
    // recentFailures is a Json column; a legacy or hand-edited row must not 500 the report.
    p.webhookSubscription.findMany.mockResolvedValue([subscription({ recentFailures: null })]);
    expect((await getWebhookReport({ familyId: FAMILY })).rows[0].recentFailures).toEqual([]);
  });

  it('serialises timestamps as ISO strings and keeps nulls null', async () => {
    p.webhookSubscription.findMany.mockResolvedValue([subscription()]);
    const report = await getWebhookReport({ familyId: FAMILY });
    expect(report.rows[0].lastSuccessAt).toBe('2026-07-20T10:00:00.000Z');
    expect(report.rows[0].lastFailureAt).toBeNull();
    expect(report.rows[0].disabledAt).toBeNull();
  });

  // AC-U15h
  it('scopes to the family for a parent', async () => {
    await getWebhookReport({ familyId: FAMILY });
    expect(p.webhookSubscription.findMany.mock.calls[0][0].where).toEqual({ familyId: FAMILY });
  });

  it('shows every subscription to an admin with no family in scope', async () => {
    await getWebhookReport({});
    expect(p.webhookSubscription.findMany.mock.calls[0][0].where).toEqual({});
  });

  it('returns an empty report when there are no subscriptions', async () => {
    expect(await getWebhookReport({ familyId: FAMILY })).toEqual({
      rows: [],
      summary: { total: 0, active: 0, autoDisabled: 0, failing: 0 },
    });
  });
});
