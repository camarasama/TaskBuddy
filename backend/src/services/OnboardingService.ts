/**
 * services/OnboardingService.ts — the guided setup wizard (growth roadmap §3.2).
 *
 * The roadmap's activation thesis: a parent who lands on an empty dashboard has to invent the whole
 * product for themselves. The wizard replaces that with four concrete steps and — the part that
 * actually matters — an **engineered first approval**, so both sides feel the full loop (submit →
 * approve → points → confetti) inside the first minute rather than a day later.
 *
 * State lives on `FamilySettings.onboardingState` rather than in the client, so it survives logout,
 * a device change, and a co-parent picking up where the first one stopped.
 */

import { prisma } from './database';
import { AnalyticsService } from './AnalyticsService';
import { NotFoundError, ConflictError } from '../middleware/errorHandler';

/** Ordered; the UI renders them in this sequence. */
export const ONBOARDING_STEPS = ['child', 'tasks', 'reward', 'handoff'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** The title of the seeded task. Also the idempotency key — see seedFirstApproval. */
export const FIRST_APPROVAL_TASK_TITLE = 'Set up my avatar';

export interface OnboardingState {
  completedSteps: OnboardingStep[];
  /** Parent chose to skip the checklist. The wizard is optional by design. */
  dismissed: boolean;
  startedAt: string | null;
  completedAt: string | null;
}

const EMPTY: OnboardingState = {
  completedSteps: [],
  dismissed: false,
  startedAt: null,
  completedAt: null,
};

/**
 * Normalise whatever is in the JSON column.
 *
 * Never trusts the stored shape: the column is free-form JSON, and an older or hand-edited value
 * must degrade to "not started" rather than crashing the dashboard that renders the checklist.
 */
export function parseState(raw: unknown): OnboardingState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  const value = raw as Partial<OnboardingState>;

  const completedSteps = Array.isArray(value.completedSteps)
    ? value.completedSteps.filter((s): s is OnboardingStep =>
        (ONBOARDING_STEPS as readonly string[]).includes(s as string),
      )
    : [];

  return {
    completedSteps: [...new Set(completedSteps)],
    dismissed: value.dismissed === true,
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null,
  };
}

export function isComplete(state: OnboardingState): boolean {
  return ONBOARDING_STEPS.every((step) => state.completedSteps.includes(step));
}

export async function getState(familyId: string): Promise<OnboardingState> {
  const settings = await prisma.familySettings.findUnique({
    where: { familyId },
    select: { onboardingState: true },
  });
  return parseState(settings?.onboardingState);
}

/**
 * Record progress.
 *
 * Emits SETUP_STEP once per step — completing a step twice must not double-count, or the funnel
 * conversion rate between steps becomes meaningless.
 */
export async function completeStep(params: {
  familyId: string;
  step: OnboardingStep;
}): Promise<OnboardingState> {
  const { familyId, step } = params;
  const current = await getState(familyId);

  const alreadyDone = current.completedSteps.includes(step);
  const next: OnboardingState = {
    ...current,
    completedSteps: alreadyDone ? current.completedSteps : [...current.completedSteps, step],
    startedAt: current.startedAt ?? new Date().toISOString(),
  };
  if (isComplete(next) && !next.completedAt) next.completedAt = new Date().toISOString();

  await persist(familyId, next);

  if (!alreadyDone) {
    void AnalyticsService.record({
      eventType: 'SETUP_STEP',
      familyId,
      actorRole: 'parent',
      payload: { step, completedCount: next.completedSteps.length },
    });
  }

  return next;
}

export async function dismiss(familyId: string): Promise<OnboardingState> {
  const current = await getState(familyId);
  const next = { ...current, dismissed: true };
  await persist(familyId, next);
  return next;
}

async function persist(familyId: string, state: OnboardingState): Promise<void> {
  // upsert, not update: a family created before FamilySettings was guaranteed would otherwise throw.
  await prisma.familySettings.upsert({
    where: { familyId },
    create: { familyId, onboardingState: state as unknown as object },
    update: { onboardingState: state as unknown as object },
  });
}

/**
 * Seed the engineered first approval: a task for the child, already submitted, waiting on the
 * parent's tap.
 *
 * This is the whole point of step 4. The parent approves it in-flow and both sides get the real
 * thing — a genuine points award, a genuine socket event, genuine confetti — rather than a mock.
 *
 * Idempotent by (child, title): re-entering step 4 must not stack up demo tasks. Created as
 * `secondary` and left in `completed` status, so it never consumes the child's CR-10 active-task
 * capacity (only pending/in_progress count).
 */
export async function seedFirstApproval(params: {
  familyId: string;
  createdBy: string;
  childId: string;
}): Promise<{ assignmentId: string; created: boolean }> {
  const { familyId, createdBy, childId } = params;

  const child = await prisma.user.findFirst({
    where: { id: childId, familyId, role: 'child', deletedAt: null },
    select: { id: true },
  });
  if (!child) throw new NotFoundError('Child not found');

  const existing = await prisma.taskAssignment.findFirst({
    where: {
      childId,
      task: { familyId, title: FIRST_APPROVAL_TASK_TITLE, deletedAt: null },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return { assignmentId: existing.id, created: false };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const assignment = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        familyId,
        createdBy,
        title: FIRST_APPROVAL_TASK_TITLE,
        description: 'Pick an avatar so everyone knows which tasks are yours.',
        category: 'Getting started',
        difficulty: 'easy',
        pointsValue: 10,
        taskTag: 'secondary',
        requiresPhotoEvidence: false,
      },
    });

    return tx.taskAssignment.create({
      data: {
        taskId: task.id,
        childId,
        instanceDate: today,
        // Pre-submitted on the child's behalf: the parent's tap is the demonstration, and waiting
        // for a real child submission would defer the aha moment past the setup session.
        status: 'completed',
        completedAt: new Date(),
      },
    });
  });

  return { assignmentId: assignment.id, created: true };
}

/** Guard: the wizard should not offer step 4 before a child exists. */
export async function requireChildExists(familyId: string): Promise<void> {
  const count = await prisma.user.count({
    where: { familyId, role: 'child', deletedAt: null },
  });
  if (count === 0) throw new ConflictError('Add a child before finishing setup.');
}

export const OnboardingService = {
  getState,
  completeStep,
  dismiss,
  seedFirstApproval,
  requireChildExists,
  parseState,
  isComplete,
  ONBOARDING_STEPS,
};
