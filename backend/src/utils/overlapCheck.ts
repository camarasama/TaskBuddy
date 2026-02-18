// backend/src/utils/overlapCheck.ts
// CR-09: Detects schedule conflicts for a child's task assignments on a given day.
// Called by POST /tasks (create) and PUT /tasks/:id (update).
// Returns warnings[] — HTTP 200, not a hard block. Frontend shows a dismissible modal.

import { prisma } from '../services/database';

export interface OverlappingTask {
  assignmentId: string;
  taskId: string;
  taskTitle: string;
  startTime: Date;
  endTime: Date;
  childId: string;
  childFirstName: string;
}

/**
 * Returns existing task assignments that conflict with the proposed time window.
 *
 * Overlap formula (standard interval):
 *   B overlaps A  if:  B.startTime < A.endTime  AND  B.endTime > A.startTime
 *
 * Edge cases:
 *   - proposed startTime is null  → all-day task; conflicts only with other all-day tasks that day.
 *   - existing task has no startTime → treated as all-day.
 *   - estimatedMinutes is null → defaults to 60 minutes for the calculation.
 *
 * @param childId           UUID of the child being assigned.
 * @param startTime         Proposed start DateTime, or null for an all-day task.
 * @param estimatedMinutes  Duration in minutes (null → defaults to 60).
 * @param instanceDate      The calendar date the assignment will live on.
 * @param excludeTaskId     Skip this task when checking (used on PUT /tasks/:id update).
 */
export async function getTaskOverlaps(
  childId: string,
  startTime: Date | null,
  estimatedMinutes: number | null,
  instanceDate: Date,
  excludeTaskId?: string
): Promise<OverlappingTask[]> {
  // Normalise to midnight so the day-boundary filter is reliable
  const dayStart = new Date(instanceDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const existingAssignments = await prisma.taskAssignment.findMany({
    where: {
      childId,
      status: { in: ['pending', 'in_progress'] },
      instanceDate: { gte: dayStart, lt: dayEnd },
      ...(excludeTaskId ? { taskId: { not: excludeTaskId } } : {}),
    },
    include: {
      task: {
        select: { id: true, title: true, startTime: true, estimatedMinutes: true },
      },
      child: {
        select: { id: true, firstName: true },
      },
    },
  });

  // ── All-day task: only clashes with other all-day tasks ──────────────────
  if (!startTime) {
    return existingAssignments
      .filter((a) => !a.task.startTime)
      .map((a) => ({
        assignmentId: a.id,
        taskId: a.task.id,
        taskTitle: a.task.title,
        startTime: dayStart,
        endTime: dayEnd,
        childId: a.childId,
        childFirstName: a.child.firstName,
      }));
  }

  // ── Timed task: standard interval overlap check ──────────────────────────
  const durationMs = (estimatedMinutes ?? 60) * 60 * 1000;
  const proposedStart = startTime.getTime();
  const proposedEnd = proposedStart + durationMs;

  const overlaps: OverlappingTask[] = [];

  for (const a of existingAssignments) {
    if (!a.task.startTime) {
      // Existing is all-day → skip (timed vs all-day don't block each other)
      continue;
    }

    const existingStart = new Date(a.task.startTime).getTime();
    const existingEnd = existingStart + ((a.task.estimatedMinutes ?? 60) * 60 * 1000);

    // Standard interval overlap: proposed overlaps existing if:
    //   proposedStart < existingEnd  AND  proposedEnd > existingStart
    if (proposedStart < existingEnd && proposedEnd > existingStart) {
      overlaps.push({
        assignmentId: a.id,
        taskId: a.task.id,
        taskTitle: a.task.title,
        startTime: new Date(existingStart),
        endTime: new Date(existingEnd),
        childId: a.childId,
        childFirstName: a.child.firstName,
      });
    }
  }

  return overlaps;
}
