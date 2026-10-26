/**
 * Re-engagement timing rules (reengagementPolicy.ts). Each case is a specific bad email the rules
 * exist to prevent: a backlog burst, an email to a long-gone family, a "finish setting up" email to
 * someone who was here yesterday, a monthly visitor emailed every month.
 */

import {
  currentEpisode,
  dueStep,
  nextManualStep,
  planFor,
  stepsInEpisode,
  type FamilyState,
  type SentStep,
} from '../src/services/reengagementPolicy';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-26T17:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function fam(over: Partial<FamilyState> = {}): FamilyState {
  return { createdAt: daysAgo(30), lastActiveAt: daysAgo(30), activated: false, sent: [], ...over };
}

function due(f: FamilyState, now = NOW): number | null {
  const ep = currentEpisode(f, now);
  return ep ? dueStep(ep, stepsInEpisode(f.sent, ep), now) : null;
}

describe('track selection', () => {
  it('puts a family with no approved task on the setup track, anchored at signup', () => {
    const f = fam({ createdAt: daysAgo(3), lastActiveAt: daysAgo(3) });
    expect(currentEpisode(f, NOW)).toEqual({ track: 'setup', anchorAt: f.createdAt });
  });

  it('puts an activated family on the lapsed track, anchored at the last activity', () => {
    const f = fam({ activated: true, lastActiveAt: daysAgo(15) });
    expect(currentEpisode(f, NOW)).toEqual({ track: 'lapsed', anchorAt: f.lastActiveAt });
  });

  it('never sends a setup email to a family active in the last two days', () => {
    const f = fam({ createdAt: daysAgo(6), lastActiveAt: daysAgo(1) });
    expect(currentEpisode(f, NOW)).toBeNull();
    // ...unless an admin deliberately presses "send next now".
    expect(currentEpisode(f, NOW, { ignoreQuiet: true })?.track).toBe('setup');
  });

  it('ends the setup episode once the family comes back after the first email', () => {
    const created = daysAgo(12);
    const sent: SentStep[] = [{ track: 'setup', step: 1, anchorAt: created, sentAt: daysAgo(10) }];
    const f = fam({ createdAt: created, lastActiveAt: daysAgo(8), sent });
    expect(currentEpisode(f, NOW)).toBeNull();
  });

  it('does not start a second lapsed episode within 60 days of the last one', () => {
    const oldAnchor = daysAgo(80);
    const sent: SentStep[] = [{ track: 'lapsed', step: 1, anchorAt: oldAnchor, sentAt: daysAgo(40) }];
    const f = fam({ activated: true, lastActiveAt: daysAgo(20), sent });
    expect(currentEpisode(f, NOW)).toBeNull();
  });
});

describe('dueStep', () => {
  it('sends nothing before the first step day', () => {
    expect(due(fam({ createdAt: daysAgo(1), lastActiveAt: daysAgo(1) }))).toBeNull();
    expect(due(fam({ activated: true, lastActiveAt: daysAgo(13) }))).toBeNull();
  });

  it('sends setup step 1 on day 2 and lapsed step 1 on day 14', () => {
    expect(due(fam({ createdAt: daysAgo(2), lastActiveAt: daysAgo(2) }))).toBe(1);
    expect(due(fam({ activated: true, lastActiveAt: daysAgo(14) }))).toBe(1);
  });

  it('sends only the LATEST due step on a late start, never the backlog', () => {
    // Silent 40 days when the feature shipped: the day-35 email, not days 14, 21 and 35.
    expect(due(fam({ activated: true, lastActiveAt: daysAgo(40) }))).toBe(3);
  });

  it('leaves families alone once the last step is more than a week overdue', () => {
    expect(due(fam({ activated: true, lastActiveAt: daysAgo(68) }))).toBeNull();
    expect(due(fam({ createdAt: daysAgo(29), lastActiveAt: daysAgo(29) }))).toBeNull();
  });

  it('does not resend a step already sent in this episode', () => {
    const anchor = daysAgo(16);
    const sent: SentStep[] = [{ track: 'lapsed', step: 1, anchorAt: anchor, sentAt: daysAgo(2) }];
    expect(due(fam({ activated: true, lastActiveAt: anchor, sent }))).toBeNull();
  });

  it('keeps steps at least three days apart', () => {
    const created = daysAgo(5);
    const sent: SentStep[] = [{ track: 'setup', step: 1, anchorAt: created, sentAt: daysAgo(1) }];
    expect(due(fam({ createdAt: created, lastActiveAt: created, sent }))).toBeNull();
    const later = new Date(NOW.getTime() + 2 * DAY);
    expect(due(fam({ createdAt: created, lastActiveAt: created, sent }), later)).toBe(2);
  });

  it('treats rows from an older lapsed episode as unrelated', () => {
    const sent: SentStep[] = [{ track: 'lapsed', step: 4, anchorAt: daysAgo(200), sentAt: daysAgo(140) }];
    expect(due(fam({ activated: true, lastActiveAt: daysAgo(14), sent }))).toBe(1);
  });
});

describe('planFor and nextManualStep', () => {
  it('reports the next step and when it is due', () => {
    const anchor = daysAgo(15);
    const sent: SentStep[] = [{ track: 'lapsed', step: 1, anchorAt: anchor, sentAt: daysAgo(1) }];
    const plan = planFor(fam({ activated: true, lastActiveAt: anchor, sent }), NOW)!;
    expect(plan.sentSteps).toEqual([1]);
    expect(plan.nextStep).toBe(2);
    expect(plan.nextDueAt?.toISOString()).toBe(new Date(anchor.getTime() + 21 * DAY).toISOString());
  });

  it('reports a finished sequence after step 4', () => {
    const anchor = daysAgo(62);
    const sent: SentStep[] = [1, 2, 3, 4].map((step, i) => ({ track: 'lapsed', step, anchorAt: anchor, sentAt: daysAgo(48 - i * 15) }));
    const plan = planFor(fam({ activated: true, lastActiveAt: anchor, sent }), NOW)!;
    expect(plan.nextStep).toBeNull();
  });

  it('manual send goes to the step after the last one, and stops after 4', () => {
    const a = daysAgo(3);
    expect(nextManualStep([])).toBe(1);
    expect(nextManualStep([{ track: 'setup', step: 2, anchorAt: a, sentAt: a }])).toBe(3);
    expect(nextManualStep([{ track: 'setup', step: 4, anchorAt: a, sentAt: a }])).toBeNull();
  });
});
