/**
 * The approval queue — the first place this app *writes*.
 *
 * ## Presigned evidence URLs
 *
 * `evidence[].fileUrl` is signed per request by `withEvidenceUrlsList()` and expires. Evidence has been
 * private on R2 since F-4, so these are not durable links: caching the payload means the photos start
 * 403-ing while the surrounding data still looks fine, which presents as "the approval queue sometimes
 * shows broken images" — a bug shape that is near-impossible to reproduce on demand.
 *
 * So, as with the dashboard, `staleTime: 0`. It is also why nothing here writes an evidence URL
 * anywhere persistent.
 *
 * ## What approve/reject invalidate
 *
 * Approving changes more than this list. It moves points, XP, possibly a level and a streak, and it
 * decrements the dashboard's pending count. Invalidating only the approvals query would leave a parent
 * looking at a dashboard that still says "3 waiting" after they cleared all three — so the mutation
 * invalidates the dashboard and the task list too. Over-invalidating costs a refetch; under-
 * invalidating shows stale numbers, and the parent believes them.
 */
import type { Achievement, Task, TaskAssignment, TaskEvidence } from '@taskbuddy/shared';

import { api } from './api';
import type { PaginationMeta } from './tasksApi';

/** One row of the queue: a completed assignment with its task, its child, and any evidence. */
export type PendingApproval = TaskAssignment & {
  task: Task;
  child: { id: string; firstName: string; lastName: string; avatarUrl?: string | null };
  evidence: TaskEvidence[];
};

export interface PendingApprovalsResponse {
  assignments: PendingApproval[];
  pagination: PaginationMeta;
}

export const APPROVALS_KEY = ['approvals', 'pending'] as const;

export function fetchPendingApprovals(
  page = 1,
  signal?: AbortSignal
): Promise<PendingApprovalsResponse> {
  return api.get<PendingApprovalsResponse>(
    `/tasks/assignments/pending?page=${page}&limit=20`,
    { signal }
  );
}

export function approvalsQuery() {
  return {
    queryKey: APPROVALS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchPendingApprovals(1, signal),
    // See the note on presigned URLs above.
    staleTime: 0,
  };
}

/**
 * What the server hands back after a decision.
 *
 * The extras are worth surfacing rather than discarding: a parent who approves a task and is told
 * "+15 points, level 4" gets confirmation that the thing they intended actually happened, which a
 * silently-vanishing row does not provide.
 */
export interface ApprovalResult {
  assignment: TaskAssignment;
  pointsAwarded?: number;
  xpAwarded?: number;
  newBalance?: number;
  newLevel?: number;
  achievementsUnlocked?: Achievement[];
  streakUpdated?: { currentStreak: number; isNewRecord: boolean };
}

export interface ApprovalDecision {
  assignmentId: string;
  approved: boolean;
  /** Shown to the child. Only meaningful on a rejection; the backend caps it at 500 characters. */
  rejectionReason?: string;
}

export function decideApproval({
  assignmentId,
  approved,
  rejectionReason,
}: ApprovalDecision): Promise<ApprovalResult> {
  return api.put<ApprovalResult>(`/tasks/assignments/${assignmentId}/approve`, {
    approved,
    // Omitted rather than sent empty when approving — the field is only meaningful on a rejection.
    ...(approved ? {} : { rejectionReason }),
  });
}

/**
 * Every query key a decision can invalidate.
 *
 * Listed in one place so a new screen that shows a points balance can be added here rather than
 * discovering months later that it goes stale after an approval.
 */
export const INVALIDATED_BY_APPROVAL = [
  APPROVALS_KEY,
  ['dashboard', 'parent'],
  ['tasks'],
] as const;
