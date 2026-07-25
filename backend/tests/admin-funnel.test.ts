/**
 * U9 — the admin funnel view (growth roadmap §1, §5.5).
 *
 * `analytics_events` has been write-only since U1: events were being recorded and nothing read them,
 * so the north star was unmeasurable in practice as well as on paper. This is the read side.
 *
 * Two statistical choices carry the unit, and both are the kind of thing that produces a
 * confidently-wrong dashboard if got wrong:
 *
 *  - **Median, not mean.** One family that took forty days drags a mean far enough to make the
 *    number useless for deciding anything.
 *  - **Families that never converted stay in the denominator.** Drop them and the conversion rate
 *    RISES as the product gets worse — the most dangerous shape a metric can have.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    analyticsEvent: { findMany: jest.fn(), count: jest.fn() },
  },
}));

import { FunnelService, median, rate } from '../src/services/FunnelService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  analyticsEvent: { findMany: jest.Mock; count: jest.Mock };
};

const FROM = new Date('2026-07-01T00:00:00Z');
const TO = new Date('2026-07-31T00:00:00Z');

/**
 * Wire the four reads getFunnel makes, in order: signups, setup steps, then the FIRST_APPROVAL
 * lookup that happens after the cohort is known.
 */
function mockEvents(opts: {
  signups?: Array<{ familyId: string; createdAt: Date }>;
  steps?: Array<{ familyId: string; payload: { step: string } }>;
  approvals?: Array<{ familyId: string; createdAt: Date }>;
  sent?: number;
  opened?: number;
}) {
  const { signups = [], steps = [], approvals = [], sent = 0, opened = 0 } = opts;
  p.analyticsEvent.findMany
    .mockResolvedValueOnce(signups)
    .mockResolvedValueOnce(steps)
    .mockResolvedValueOnce(approvals);
  p.analyticsEvent.count.mockResolvedValueOnce(sent).mockResolvedValueOnce(opened);
}

beforeEach(() => jest.clearAllMocks());

describe('median', () => {
  it('is null for an empty set rather than 0', () => {
    // 0 would read as "instant activation", which is the opposite of "no data".
    expect(median([])).toBeNull();
  });

  it('takes the middle of an odd-length set', () => {
    expect(median([1, 100, 5])).toBe(5);
  });

  it('averages the two middles of an even-length set', () => {
    expect(median([1, 3, 5, 7])).toBe(4);
  });

  it('is not dragged by one extreme value, unlike a mean', () => {
    // The reason this is a median at all: the mean here is 205.
    expect(median([2, 3, 4, 5, 1000])).toBe(4);
  });

  it('does not mutate its input', () => {
    const input = [3, 1, 2];
    median(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('rate', () => {
  it('is null when the denominator is zero — never NaN', () => {
    expect(rate(0, 0)).toBeNull();
  });

  it('returns one decimal place', () => {
    expect(rate(1, 3)).toBe(33.3);
  });

  it('handles a perfect rate', () => {
    expect(rate(5, 5)).toBe(100);
  });
});

describe('getFunnel', () => {
  it('counts the signup cohort', async () => {
    mockEvents({
      signups: [
        { familyId: 'a', createdAt: new Date('2026-07-02T00:00:00Z') },
        { familyId: 'b', createdAt: new Date('2026-07-03T00:00:00Z') },
      ],
    });

    const funnel = await FunnelService.getFunnel({ from: FROM, to: TO });
    expect(funnel.signups).toBe(2);
  });

  // AC-U9d — the metric-shape property.
  it('keeps families that never converted in the denominator', async () => {
    mockEvents({
      signups: [
        { familyId: 'converted', createdAt: new Date('2026-07-02T00:00:00Z') },
        { familyId: 'never', createdAt: new Date('2026-07-02T00:00:00Z') },
        { familyId: 'also-never', createdAt: new Date('2026-07-02T00:00:00Z') },
      ],
      approvals: [{ familyId: 'converted', createdAt: new Date('2026-07-03T00:00:00Z') }],
    });

    const funnel = await FunnelService.getFunnel({ from: FROM, to: TO });

    expect(funnel.signups).toBe(3);
    expect(funnel.activated).toBe(1);
    expect(funnel.activationRate).toBe(33.3); // NOT 100
  });

  it('reports median hours to first approval', async () => {
    mockEvents({
      signups: [
        { familyId: 'a', createdAt: new Date('2026-07-02T00:00:00Z') },
        { familyId: 'b', createdAt: new Date('2026-07-02T00:00:00Z') },
        { familyId: 'c', createdAt: new Date('2026-07-02T00:00:00Z') },
      ],
      approvals: [
        { familyId: 'a', createdAt: new Date('2026-07-02T01:00:00Z') }, // 1h
        { familyId: 'b', createdAt: new Date('2026-07-02T05:00:00Z') }, // 5h
        { familyId: 'c', createdAt: new Date('2026-08-01T00:00:00Z') }, // ~720h outlier
      ],
    });

    const funnel = await FunnelService.getFunnel({ from: FROM, to: TO });
    expect(funnel.medianHoursToFirstApproval).toBe(5);
  });

  it('takes the EARLIEST approval when a family somehow has several', async () => {
    mockEvents({
      signups: [{ familyId: 'a', createdAt: new Date('2026-07-02T00:00:00Z') }],
      approvals: [
        { familyId: 'a', createdAt: new Date('2026-07-05T00:00:00Z') },
        { familyId: 'a', createdAt: new Date('2026-07-03T00:00:00Z') },
      ],
    });

    const funnel = await FunnelService.getFunnel({ from: FROM, to: TO });
    expect(funnel.medianHoursToFirstApproval).toBe(24); // from the 07-03 one
  });

  // AC-U9c
  it('counts DISTINCT families per setup step', async () => {
    mockEvents({
      signups: [{ familyId: 'a', createdAt: FROM }],
      steps: [
        { familyId: 'a', payload: { step: 'child' } },
        { familyId: 'a', payload: { step: 'child' } }, // duplicate must not inflate
        { familyId: 'b', payload: { step: 'child' } },
        { familyId: 'a', payload: { step: 'tasks' } },
      ],
    });

    const funnel = await FunnelService.getFunnel({ from: FROM, to: TO });

    expect(funnel.setupSteps.find((s) => s.step === 'child')!.families).toBe(2);
    expect(funnel.setupSteps.find((s) => s.step === 'tasks')!.families).toBe(1);
  });

  it('ignores a setup event with no step in its payload', async () => {
    mockEvents({
      signups: [{ familyId: 'a', createdAt: FROM }],
      steps: [{ familyId: 'a', payload: {} as { step: string } }],
    });

    const funnel = await FunnelService.getFunnel({ from: FROM, to: TO });
    expect(funnel.setupSteps).toEqual([]);
  });

  it('reports the digest open rate', async () => {
    mockEvents({ signups: [], sent: 40, opened: 18 });
    const funnel = await FunnelService.getFunnel({ from: FROM, to: TO });
    expect(funnel).toMatchObject({ digestsSent: 40, digestsOpened: 18, digestOpenRate: 45 });
  });

  // AC-U9f
  it('returns zeroes and NULLS for an empty window, never NaN', async () => {
    mockEvents({});
    const funnel = await FunnelService.getFunnel({ from: FROM, to: TO });

    expect(funnel).toMatchObject({
      signups: 0,
      activated: 0,
      activationRate: null,
      medianHoursToFirstApproval: null,
      digestOpenRate: null,
    });
    expect(Number.isNaN(funnel.activationRate as number)).toBe(false);
  });

  it('does not query approvals at all when nobody signed up', async () => {
    // Guards against `familyId: { in: [] }`, which some drivers treat as "match everything".
    mockEvents({});
    await FunnelService.getFunnel({ from: FROM, to: TO });
    expect(p.analyticsEvent.findMany).toHaveBeenCalledTimes(2); // signups + steps only
  });

  it('scopes every read to the window', async () => {
    mockEvents({ signups: [] });
    await FunnelService.getFunnel({ from: FROM, to: TO });

    const signupWhere = p.analyticsEvent.findMany.mock.calls[0][0].where;
    expect(signupWhere.createdAt).toEqual({ gte: FROM, lte: TO });
    expect(signupWhere.eventType).toBe('SIGNUP');
  });

  it('echoes the window back, so a stale dashboard is identifiable', async () => {
    mockEvents({});
    const funnel = await FunnelService.getFunnel({ from: FROM, to: TO });
    expect(funnel.window).toEqual({ from: FROM.toISOString(), to: TO.toISOString() });
  });
});
