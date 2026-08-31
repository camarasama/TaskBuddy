/**
 * When it is reasonable to ask a parent to rate the app.
 *
 * Deliberately free of `expo-store-review` and `expo-secure-store`, which are both native modules:
 * importing one of those into a module a screen pulls in has previously broken unrelated test suites
 * outright. The decision lives here as plain data so it can be tested exhaustively, and
 * `reviewPrompt.ts` is the thin bridge that owns the two native calls.
 *
 * ## The policy, and why each number is what it is
 *
 * The prompt is not free. Google throttles it, an unspent quota is gone until it refreshes, and a
 * parent asked at the wrong moment leaves the review the prompt was meant to earn.
 *
 * - **Five approvals first.** One approval means a parent finished setup; it says nothing about
 *   whether the app is working for their family. Five means the loop has actually run, which is the
 *   first moment there is an honest answer to give.
 * - **Three prompts, ever.** Play's own quota is a handful a year. Anything past a polite second
 *   attempt is nagging, and the app has a permanent "Rate TaskBuddy" row in Settings for anyone who
 *   decides on their own.
 * - **A hundred and twenty days apart.** Long enough that a parent who ignored it has genuinely moved
 *   on, rather than being asked again about the same week of chores.
 */

export interface ReviewState {
  /** Approvals granted on this device since install. Rejections never count. */
  approvals: number;
  /** Times the sheet has been requested. See the note in `reviewPrompt.ts` about what that means. */
  prompts: number;
  /** ISO timestamp of the last request, or null if never. */
  lastPromptedAt: string | null;
}

export const EMPTY_REVIEW_STATE: ReviewState = {
  approvals: 0,
  prompts: 0,
  lastPromptedAt: null,
};

export const MIN_APPROVALS_BEFORE_FIRST_PROMPT = 5;
export const MAX_PROMPTS = 3;
export const MIN_DAYS_BETWEEN_PROMPTS = 120;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Read stored state, falling back to a clean slate on anything unexpected.
 *
 * A corrupt value resets the counters rather than throwing, which at worst asks a parent once more
 * than intended. The alternative, treating unreadable state as "already prompted", silences the
 * prompt permanently on that device, and does it invisibly.
 */
export function parseReviewState(raw: string | null): ReviewState {
  if (raw === null) return EMPTY_REVIEW_STATE;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_REVIEW_STATE;

    const { approvals, prompts, lastPromptedAt } = parsed as Record<string, unknown>;
    return {
      approvals: typeof approvals === 'number' && approvals >= 0 ? approvals : 0,
      prompts: typeof prompts === 'number' && prompts >= 0 ? prompts : 0,
      lastPromptedAt: typeof lastPromptedAt === 'string' ? lastPromptedAt : null,
    };
  } catch {
    return EMPTY_REVIEW_STATE;
  }
}

export function recordApproval(state: ReviewState): ReviewState {
  return { ...state, approvals: state.approvals + 1 };
}

export function recordPrompt(state: ReviewState, now: Date): ReviewState {
  return { ...state, prompts: state.prompts + 1, lastPromptedAt: now.toISOString() };
}

export function shouldPrompt(state: ReviewState, now: Date): boolean {
  if (state.approvals < MIN_APPROVALS_BEFORE_FIRST_PROMPT) return false;
  if (state.prompts >= MAX_PROMPTS) return false;
  if (state.lastPromptedAt === null) return true;

  const last = Date.parse(state.lastPromptedAt);
  // An unparseable timestamp with a real prompt count behind it: wait rather than ask, because the
  // count already proves this parent has been asked at least once.
  if (Number.isNaN(last)) return false;

  // A clock that moved backwards (timezone change, a manually set date) yields a negative gap. Treat
  // it as "not long enough" rather than as licence to ask again immediately.
  const days = (now.getTime() - last) / MS_PER_DAY;
  return days >= MIN_DAYS_BETWEEN_PROMPTS;
}
