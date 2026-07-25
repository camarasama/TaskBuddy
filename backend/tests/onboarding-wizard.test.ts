/**
 * U4b — the guided setup wizard (growth roadmap §3.2).
 *
 * Two things carry the weight:
 *
 *  1. **State survives.** It lives on FamilySettings, not in the client, so logging out, switching
 *     device, or a co-parent picking it up all resume rather than restart. It must also degrade to
 *     "not started" on a malformed value rather than crashing the dashboard that renders it.
 *
 *  2. **The engineered first approval is idempotent.** Re-entering the final step must reuse the
 *     same assignment; stacking demo tasks would turn the aha moment into clutter the parent then
 *     has to clean up.
 */

jest.mock('../src/services/database', () => {
  const tx = {
    task: { create: jest.fn() },
    taskAssignment: { create: jest.fn() },
  };
  return {
    prisma: {
      familySettings: { findUnique: jest.fn(), upsert: jest.fn() },
      taskAssignment: { findFirst: jest.fn() },
      user: { findFirst: jest.fn(), count: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      __tx: tx,
    },
  };
});

const mockRecord = jest.fn();
jest.mock('../src/services/AnalyticsService', () => ({
  AnalyticsService: { record: (...a: unknown[]) => mockRecord(...a) },
}));

import {
  FIRST_APPROVAL_TASK_TITLE,
  ONBOARDING_STEPS,
  OnboardingService,
  parseState,
} from '../src/services/OnboardingService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  familySettings: { findUnique: jest.Mock; upsert: jest.Mock };
  taskAssignment: { findFirst: jest.Mock };
  user: { findFirst: jest.Mock; count: jest.Mock };
  __tx: { task: { create: jest.Mock }; taskAssignment: { create: jest.Mock } };
};

const FAMILY = 'fam-1';
const CHILD = 'a3f1c2d4-0000-4000-8000-000000000001';

/** What the service most recently wrote to the JSON column. */
function persisted() {
  const calls = p.familySettings.upsert.mock.calls;
  return calls[calls.length - 1]?.[0]?.update?.onboardingState;
}

beforeEach(() => {
  jest.clearAllMocks();
  p.familySettings.upsert.mockResolvedValue({});
  p.familySettings.findUnique.mockResolvedValue({ onboardingState: null });
});

describe('parseState', () => {
  it('treats an absent value as not started', () => {
    expect(parseState(null)).toMatchObject({ completedSteps: [], dismissed: false });
  });

  it('degrades a malformed value rather than throwing', () => {
    // The column is free-form JSON; a hand-edited or older value must not crash the dashboard.
    expect(parseState('nonsense')).toMatchObject({ completedSteps: [] });
    expect(parseState({ completedSteps: 'child' })).toMatchObject({ completedSteps: [] });
  });

  it('drops step ids it does not recognise', () => {
    expect(parseState({ completedSteps: ['child', 'teleport'] }).completedSteps).toEqual(['child']);
  });

  it('de-duplicates repeated steps', () => {
    expect(parseState({ completedSteps: ['child', 'child'] }).completedSteps).toEqual(['child']);
  });
});

describe('completeStep', () => {
  it('records the step and stamps a start time', async () => {
    const state = await OnboardingService.completeStep({ familyId: FAMILY, step: 'child' });
    expect(state.completedSteps).toEqual(['child']);
    expect(state.startedAt).toBeTruthy();
  });

  it('emits SETUP_STEP', async () => {
    await OnboardingService.completeStep({ familyId: FAMILY, step: 'child' });
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'SETUP_STEP', familyId: FAMILY }),
    );
  });

  it('does NOT emit SETUP_STEP twice for the same step', async () => {
    // Double-counting would make the step-to-step conversion rate meaningless.
    p.familySettings.findUnique.mockResolvedValue({
      onboardingState: { completedSteps: ['child'], dismissed: false, startedAt: 'x', completedAt: null },
    });
    await OnboardingService.completeStep({ familyId: FAMILY, step: 'child' });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('stamps completedAt only when every step is done', async () => {
    p.familySettings.findUnique.mockResolvedValue({
      onboardingState: {
        completedSteps: ONBOARDING_STEPS.slice(0, -1),
        dismissed: false,
        startedAt: 'x',
        completedAt: null,
      },
    });
    const state = await OnboardingService.completeStep({
      familyId: FAMILY,
      step: ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1],
    });
    expect(state.completedAt).toBeTruthy();
    expect(OnboardingService.isComplete(state)).toBe(true);
  });

  it('persists to FamilySettings so the checklist survives logout', async () => {
    await OnboardingService.completeStep({ familyId: FAMILY, step: 'tasks' });
    expect(persisted()).toMatchObject({ completedSteps: ['tasks'] });
  });

  it('upserts rather than updates, so a family with no settings row still works', async () => {
    await OnboardingService.completeStep({ familyId: FAMILY, step: 'tasks' });
    expect(p.familySettings.upsert.mock.calls[0][0].create).toMatchObject({ familyId: FAMILY });
  });
});

describe('dismiss', () => {
  it('marks the checklist skipped without losing progress', async () => {
    p.familySettings.findUnique.mockResolvedValue({
      onboardingState: { completedSteps: ['child'], dismissed: false, startedAt: 'x', completedAt: null },
    });
    const state = await OnboardingService.dismiss(FAMILY);
    expect(state.dismissed).toBe(true);
    expect(state.completedSteps).toEqual(['child']);
  });
});

describe('seedFirstApproval', () => {
  beforeEach(() => {
    p.user.findFirst.mockResolvedValue({ id: CHILD });
    p.taskAssignment.findFirst.mockResolvedValue(null);
    p.__tx.task.create.mockResolvedValue({ id: 'task-1' });
    p.__tx.taskAssignment.create.mockResolvedValue({ id: 'assign-1' });
  });

  it('creates the task already submitted, so the parent only has to approve', async () => {
    const result = await OnboardingService.seedFirstApproval({
      familyId: FAMILY, createdBy: 'parent-1', childId: CHILD,
    });

    expect(result).toMatchObject({ assignmentId: 'assign-1', created: true });
    expect(p.__tx.taskAssignment.create.mock.calls[0][0].data.status).toBe('completed');
  });

  it('tags it secondary, so it never eats the child’s CR-10 active capacity', async () => {
    await OnboardingService.seedFirstApproval({ familyId: FAMILY, createdBy: 'parent-1', childId: CHILD });
    expect(p.__tx.task.create.mock.calls[0][0].data.taskTag).toBe('secondary');
  });

  it('is idempotent — re-entering the step reuses the same assignment', async () => {
    // Stacking demo tasks would turn the aha moment into clutter the parent has to clear up.
    p.taskAssignment.findFirst.mockResolvedValue({ id: 'existing-1' });

    const result = await OnboardingService.seedFirstApproval({
      familyId: FAMILY, createdBy: 'parent-1', childId: CHILD,
    });

    expect(result).toEqual({ assignmentId: 'existing-1', created: false });
    expect(p.__tx.task.create).not.toHaveBeenCalled();
  });

  it('matches the existing task by its known title', async () => {
    await OnboardingService.seedFirstApproval({ familyId: FAMILY, createdBy: 'parent-1', childId: CHILD });
    const where = p.taskAssignment.findFirst.mock.calls[0][0].where;
    expect(where.task.title).toBe(FIRST_APPROVAL_TASK_TITLE);
  });

  it('404s for a child outside the family', async () => {
    p.user.findFirst.mockResolvedValue(null);
    await expect(
      OnboardingService.seedFirstApproval({ familyId: FAMILY, createdBy: 'parent-1', childId: CHILD }),
    ).rejects.toThrow(/not found/i);
  });

  it('creates task and assignment in one transaction', async () => {
    await OnboardingService.seedFirstApproval({ familyId: FAMILY, createdBy: 'parent-1', childId: CHILD });
    expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).toHaveBeenCalled();
  });
});

describe('requireChildExists', () => {
  it('blocks the final step when the family has no children yet', async () => {
    p.user.count.mockResolvedValue(0);
    await expect(OnboardingService.requireChildExists(FAMILY)).rejects.toThrow(/add a child/i);
  });

  it('allows it once a child exists', async () => {
    p.user.count.mockResolvedValue(1);
    await expect(OnboardingService.requireChildExists(FAMILY)).resolves.toBeUndefined();
  });
});
