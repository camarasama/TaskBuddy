/**
 * The prompt budget is spent silently: Play throttles the sheet and tells the app nothing, so a policy
 * bug here does not surface as a failure, it surfaces as parents being asked too often or never asked
 * at all. Both are invisible from inside the app, which is why the rules are pure functions with
 * exhaustive tests rather than conditions scattered through a screen.
 */
import {
  EMPTY_REVIEW_STATE,
  MAX_PROMPTS,
  MIN_APPROVALS_BEFORE_FIRST_PROMPT,
  MIN_DAYS_BETWEEN_PROMPTS,
  parseReviewState,
  recordApproval,
  recordPrompt,
  shouldPrompt,
  type ReviewState,
} from '@/lib/reviewPolicy';

const NOW = new Date('2026-08-31T12:00:00.000Z');

function daysBefore(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function state(overrides: Partial<ReviewState> = {}): ReviewState {
  return { ...EMPTY_REVIEW_STATE, ...overrides };
}

describe('parseReviewState', () => {
  it('starts clean when nothing has been stored', () => {
    expect(parseReviewState(null)).toEqual(EMPTY_REVIEW_STATE);
  });

  it.each([
    ['malformed JSON', '{ not json'],
    ['a JSON primitive', '"hello"'],
    ['null', 'null'],
  ])('resets on %s rather than throwing', (_label, raw) => {
    // Throwing here would surface inside an approval, which must never fail for this reason.
    expect(parseReviewState(raw)).toEqual(EMPTY_REVIEW_STATE);
  });

  it('drops fields of the wrong type instead of trusting them', () => {
    const parsed = parseReviewState(
      JSON.stringify({ approvals: 'lots', prompts: -4, lastPromptedAt: 12 })
    );

    expect(parsed).toEqual(EMPTY_REVIEW_STATE);
  });

  it('round-trips a state it wrote itself', () => {
    const original = state({ approvals: 7, prompts: 1, lastPromptedAt: daysBefore(30) });

    expect(parseReviewState(JSON.stringify(original))).toEqual(original);
  });
});

describe('recording', () => {
  it('counts an approval without touching the prompt budget', () => {
    expect(recordApproval(state({ approvals: 4, prompts: 1 }))).toEqual(
      state({ approvals: 5, prompts: 1 })
    );
  });

  it('stamps the prompt with the time it was requested', () => {
    const after = recordPrompt(state({ approvals: 9 }), NOW);

    expect(after.prompts).toBe(1);
    expect(after.lastPromptedAt).toBe(NOW.toISOString());
  });
});

describe('shouldPrompt', () => {
  it('stays quiet until the parent has actually used the app', () => {
    // One approval means setup finished. It says nothing about whether the app works for this family.
    expect(shouldPrompt(state({ approvals: MIN_APPROVALS_BEFORE_FIRST_PROMPT - 1 }), NOW)).toBe(
      false
    );
  });

  it('asks once the loop has genuinely run a few times', () => {
    expect(shouldPrompt(state({ approvals: MIN_APPROVALS_BEFORE_FIRST_PROMPT }), NOW)).toBe(true);
  });

  it('stops for good once the budget is spent', () => {
    // Settings keeps a permanent "Rate TaskBuddy" row, so a willing parent is never locked out.
    const spent = state({ approvals: 500, prompts: MAX_PROMPTS, lastPromptedAt: daysBefore(9999) });

    expect(shouldPrompt(spent, NOW)).toBe(false);
  });

  it('waits out the gap between prompts', () => {
    const recent = state({
      approvals: 50,
      prompts: 1,
      lastPromptedAt: daysBefore(MIN_DAYS_BETWEEN_PROMPTS - 1),
    });

    expect(shouldPrompt(recent, NOW)).toBe(false);
  });

  it('asks again once the gap has passed', () => {
    const old = state({
      approvals: 50,
      prompts: 1,
      lastPromptedAt: daysBefore(MIN_DAYS_BETWEEN_PROMPTS),
    });

    expect(shouldPrompt(old, NOW)).toBe(true);
  });

  it('waits rather than asks when the stored timestamp is unreadable', () => {
    // The prompt count already proves this parent has been asked. Asking again on the strength of a
    // corrupt date is the one failure mode that reads as harassment.
    const corrupt = state({ approvals: 50, prompts: 1, lastPromptedAt: 'not a date' });

    expect(shouldPrompt(corrupt, NOW)).toBe(false);
  });

  it('does not treat a backwards clock as permission to ask again', () => {
    // A timezone change or a manually set date puts the last prompt in the future.
    const future = state({ approvals: 50, prompts: 1, lastPromptedAt: daysBefore(-30) });

    expect(shouldPrompt(future, NOW)).toBe(false);
  });
});
