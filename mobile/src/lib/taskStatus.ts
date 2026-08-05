/**
 * What an assignment status means to a child.
 *
 * Extracted rather than inlined because the dashboard and the tasks screen must agree: if the home tab
 * counts "3 of 5 done" using one rule and the tasks list strikes through rows using another, the app
 * contradicts itself on two screens a tap apart.
 *
 * The union is `pending | in_progress | completed | approved | rejected` (shared's `AssignmentStatus`).
 * Two of those carry judgement worth stating:
 *
 * - **`completed` counts as done.** The child has finished; approval is the parent's turn, not more
 *   work. Excluding it would show a child who did everything a bar reading 0%, waiting on somebody
 *   else — demotivating and inaccurate about what *they* did.
 * - **`rejected` does not count as done, and is not a failure state either.** It goes back to being
 *   outstanding work, which is exactly what a rejection means: do it again.
 */
import type { AssignmentStatus } from '@taskbuddy/shared';

/** Finished by the child, whether or not a parent has approved it yet. */
export function isDone(status: AssignmentStatus): boolean {
  return status === 'completed' || status === 'approved';
}

/** Still requiring something from the child — including a rejected task, which is back in their court. */
export function isOutstanding(status: AssignmentStatus): boolean {
  return !isDone(status);
}

/**
 * Completion as a 0-100 percentage.
 *
 * Returns 0 for an empty list rather than NaN. A `0/0` division reaches the UI as a NaN-width progress
 * bar, which React Native renders as a layout warning and a bar of unpredictable size — and "no tasks
 * today" is legitimately 0% complete, not undefined.
 */
export function completionPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (done / total) * 100));
}
