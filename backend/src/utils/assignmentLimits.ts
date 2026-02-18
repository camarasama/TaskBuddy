// backend/src/utils/assignmentLimits.ts
// CR-10: Enforces max 3 active assignments and max 1 active primary per child.
// Called by POST /tasks (create) and POST /tasks/assignments/self-assign.

import { prisma } from '../services/database';

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface ChildCapacity {
  totalActive: number;
  primaryActive: number;
  maxTotal: number;
  maxPrimary: number;
}

/**
 * Checks whether a child is allowed to receive a new task assignment.
 *
 * Rules:
 *   - Max 3 active (pending / in_progress) assignments at any time.
 *   - Of those 3, at most 1 may be tagged "primary".
 *
 * Returns { allowed: true } or { allowed: false, reason: "..." }
 */
export async function checkAssignmentLimits(
  childId: string,
  taskTag: 'primary' | 'secondary'
): Promise<LimitCheckResult> {
  const activeAssignments = await prisma.taskAssignment.findMany({
    where: {
      childId,
      status: { in: ['pending', 'in_progress'] },
    },
    include: {
      task: { select: { taskTag: true } },
    },
  });

  const totalActive = activeAssignments.length;

  // Hard cap: max 3 total
  if (totalActive >= 3) {
    return {
      allowed: false,
      reason: 'This child already has 3 active tasks. Complete or remove an existing task first.',
    };
  }

  // Hard cap: max 1 primary
  if (taskTag === 'primary') {
    const activePrimaries = activeAssignments.filter(
      (a) => a.task.taskTag === 'primary'
    ).length;

    if (activePrimaries >= 1) {
      return {
        allowed: false,
        reason:
          'This child already has an active primary task. Only 1 primary task is allowed at a time.',
      };
    }
  }

  return { allowed: true };
}

/**
 * Returns a child's current task capacity summary.
 * Used by the parent UI to render capacity badges: "2/3 tasks | 1 primary".
 */
export async function getChildCapacity(childId: string): Promise<ChildCapacity> {
  const activeAssignments = await prisma.taskAssignment.findMany({
    where: {
      childId,
      status: { in: ['pending', 'in_progress'] },
    },
    include: {
      task: { select: { taskTag: true } },
    },
  });

  return {
    totalActive: activeAssignments.length,
    primaryActive: activeAssignments.filter((a) => a.task.taskTag === 'primary').length,
    maxTotal: 3,
    maxPrimary: 1,
  };
}
