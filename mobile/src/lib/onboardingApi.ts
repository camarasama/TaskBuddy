/**
 * The guided setup wizard's server state (growth roadmap §3.2, ported U6).
 *
 * Progress lives on `FamilySettings.onboardingState`, not on the client — see
 * `backend/src/services/OnboardingService.ts`. That is what lets `mobile/app/(parent)/welcome.tsx`
 * trust a fresh `GET /onboarding` on every mount instead of carrying its own notion of "done":
 * closing the app mid-wizard loses nothing, and a co-parent on a second device sees the same
 * checklist.
 *
 * Mirrors `frontend/src/lib/api.ts`'s `onboardingApi` one-for-one. `welcome.tsx` is the only caller —
 * nothing else in the app needs setup progress, so this stays a thin wrapper rather than growing a
 * shared query-key export list like `parentWriteApi.ts` has.
 */
import { api } from './api';

/** Ordered; `welcome.tsx` renders them in this sequence. Matches the backend's own ordering exactly. */
export const ONBOARDING_STEPS = ['child', 'tasks', 'reward', 'handoff'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  completedSteps: OnboardingStep[];
  /** The parent chose to skip the checklist. It is optional by design — never re-forced. */
  dismissed: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

export interface OnboardingStateResponse {
  state: OnboardingState;
  steps: OnboardingStep[];
  isComplete: boolean;
}

export function fetchOnboardingState(signal?: AbortSignal): Promise<OnboardingStateResponse> {
  return api.get<OnboardingStateResponse>('/onboarding', { signal });
}

export const ONBOARDING_KEY = ['onboarding'] as const;

export function onboardingQuery() {
  return {
    queryKey: ONBOARDING_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchOnboardingState(signal),
  };
}

export interface CompleteStepResponse {
  state: OnboardingState;
  isComplete: boolean;
}

/** Marks a step done. Safe to call twice — the server no-ops and returns the same state either way. */
export function completeOnboardingStep(step: OnboardingStep): Promise<CompleteStepResponse> {
  return api.post<CompleteStepResponse>(`/onboarding/steps/${step}`);
}

export function dismissOnboarding(): Promise<{ state: OnboardingState }> {
  return api.post<{ state: OnboardingState }>('/onboarding/dismiss');
}

export interface SeedFirstApprovalResult {
  assignmentId: string;
  /** False when a prior visit to step 4 already seeded one — the same assignment is reused. */
  created: boolean;
}

/**
 * Seed the pre-submitted "Set up my avatar" task for `childId`, ready for the real approval call
 * (`decideApproval` in `approvalsApi.ts`). This endpoint only seeds; it never approves — the caller
 * runs the genuine approval pipeline so the points, XP and socket event are real, not mocked.
 */
export function seedFirstApproval(childId: string): Promise<SeedFirstApprovalResult> {
  return api.post<SeedFirstApprovalResult>('/onboarding/first-approval', { childId });
}
