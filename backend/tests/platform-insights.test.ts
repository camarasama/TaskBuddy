/**
 * Admin Overview maths: lifecycle stages, activation rate, weekly signups and the cohort grid.
 * The SQL parts are thin counts; the definitions that could quietly mislead live here.
 */

jest.mock('../src/services/database', () => ({ prisma: {} }));

import { stageOf } from '../src/services/lifecycle';
import {
  activationRate,
  cohortGrid,
  lifecycleCounts,
  weekStart,
  weeklySignups,
  type FamilyRow,
} from '../src/services/PlatformInsightsService';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-26T12:00:00Z'); // a Monday
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function row(over: Partial<FamilyRow> = {}): FamilyRow {
  return {
    id: Math.random().toString(36).slice(2),
    createdAt: daysAgo(30),
    lastActiveAt: daysAgo(30),
    isTest: false,
    cameBack: true,
    firstApprovedAt: null,
    parents: 1,
    children: 1,
    ...over,
  };
}

describe('stageOf', () => {
  it.each([
    ['new', { createdAt: daysAgo(3), lastActiveAt: daysAgo(3), cameBack: false }],
    ['engaged', { createdAt: daysAgo(30), lastActiveAt: daysAgo(2), cameBack: true }],
    ['at_risk', { createdAt: daysAgo(30), lastActiveAt: daysAgo(10), cameBack: true }],
    ['dormant', { createdAt: daysAgo(90), lastActiveAt: daysAgo(40), cameBack: true }],
    ['one_and_done', { createdAt: daysAgo(20), lastActiveAt: daysAgo(20), cameBack: false }],
    ['churned', { createdAt: daysAgo(200), lastActiveAt: daysAgo(100), cameBack: false }],
  ])('%s', (stage, f) => {
    expect(stageOf(f, NOW)).toBe(stage);
  });

  it('falls back to signup when there is no recorded activity', () => {
    expect(stageOf({ createdAt: daysAgo(10), lastActiveAt: null, cameBack: false }, NOW)).toBe('one_and_done');
  });

  it('puts every family in exactly one stage', () => {
    const fams = [row(), row({ createdAt: daysAgo(1) }), row({ lastActiveAt: daysAgo(1) })];
    const counts = lifecycleCounts(fams, NOW);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('activationRate', () => {
  it('counts a task approved within 7 days of signup, not one approved later', () => {
    const fams = [
      row({ createdAt: daysAgo(10), firstApprovedAt: daysAgo(8) }),
      row({ createdAt: daysAgo(12), firstApprovedAt: daysAgo(1) }),
    ];
    expect(activationRate(fams, NOW, 30)).toEqual({ rate: 50, cohort: 2 });
  });

  it('leaves out families still inside their first week, so signups do not drag the rate down', () => {
    const fams = [row({ createdAt: daysAgo(2) }), row({ createdAt: daysAgo(10), firstApprovedAt: daysAgo(9) })];
    expect(activationRate(fams, NOW, 30)).toEqual({ rate: 100, cohort: 1 });
  });

  it('is null, not 0, with nobody in the window', () => {
    expect(activationRate([], NOW, 30).rate).toBeNull();
  });
});

describe('weekly buckets', () => {
  it('weeks start on Monday UTC', () => {
    expect(weekStart(new Date('2026-10-29T08:00:00Z')).toISOString()).toBe('2026-10-26T00:00:00.000Z');
  });

  it('weeklySignups counts signups and their 7-day activations per week', () => {
    const fams = [
      row({ createdAt: daysAgo(5), firstApprovedAt: daysAgo(4) }),
      row({ createdAt: daysAgo(6) }),
    ];
    const weeks = weeklySignups(fams, NOW);
    expect(weeks).toHaveLength(8);
    expect(weeks[6]).toEqual({ weekStart: '2026-10-19', total: 2, activated: 1 });
  });

  it('cohortGrid marks unstarted weeks null and measures week-k activity', () => {
    const a = row({ id: 'a', createdAt: new Date('2026-10-19T10:00:00Z') });
    const b = row({ id: 'b', createdAt: new Date('2026-10-20T10:00:00Z') });
    const days = new Map([
      ['a', ['2026-10-19', '2026-10-26']],
      ['b', ['2026-10-20']],
    ]);
    const grid = cohortGrid([a, b], days, NOW);
    const cohort = grid[6];
    expect(cohort.size).toBe(2);
    expect(cohort.cells[0]).toBe(100);
    expect(cohort.cells[1]).toBe(50);
    expect(cohort.cells[2]).toBeNull();
  });
});
