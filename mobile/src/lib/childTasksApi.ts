/**
 * Task reads and writes for the child shell.
 *
 * The child variant of `GET /tasks`, promised in the note at the top of `tasksApi.ts`. A child's
 * payload carries three things a parent's does not — `canSelfAssign`, the claim counters, and team
 * progress — and modelling them as one optional-heavy type would make both shapes harder to read.
 *
 * ## The server already did the hard part
 *
 * The web's child task page reconstructs the claimable pool on the client: it merges the assignments
 * list with the tasks list, de-duplicates by id, and re-derives which tasks are still open. **None of
 * that is necessary.** `GET /tasks` for a child already applies `distinct: ['id']`, already filters out
 * tasks that hit `maxClaimsTotal`, and already returns a per-task `canSelfAssign` that accounts for the
 * pending-primary rule. Re-deriving it here would mean two implementations of one rule, disagreeing the
 * first time either changes. So this module reads the flag and nothing more.
 *
 * ## Why `myAssignmentsQuery` pins staleTime 0 and `availableTasksQuery` does not
 *
 * `GET /tasks/assignments/me` runs its evidence rows through `withEvidenceUrlsList`, which **presigns**
 * them — short-lived URLs against private R2 storage. Serving that payload from a 30-second cache means
 * photos that 403 while the surrounding data still looks fresh. `GET /tasks` presigns nothing.
 */
import type { Task, TaskAssignment, TaskEvidence } from '@taskbuddy/shared';

import { api } from './api';
import { CHILD_DASHBOARD_KEY } from './childDashboardApi';
import type { PaginationMeta } from './tasksApi';

/** Team progress, attached to any assignment or task whose `isTeamTask` is set (U17). */
export interface TeamSummary {
  bonusPoints: number;
  bonusAwarded: boolean;
  members: {
    childId: string;
    firstName: string;
    avatarUrl?: string | null;
    status: string;
  }[];
}

/** A task as the list endpoint returns it to a child. */
export type ChildTask = Task & {
  /**
   * Server's verdict on whether this child may claim it right now. Accounts for the task tag, the
   * pending-primary rule and whether they already hold it — do not second-guess it on the device.
   */
  canSelfAssign: boolean;
  claimedCount: number;
  /** null when the task has no `maxClaimsTotal`, i.e. unlimited. */
  claimsRemaining: number | null;
  team: TeamSummary | null;
};

export interface ChildTasksResponse {
  tasks: ChildTask[];
  /**
   * True when the child holds an unfinished *primary* task. The server uses it to force
   * `canSelfAssign: false` everywhere, so it is only useful here for explaining *why* nothing is
   * claimable — a row of disabled buttons with no reason reads as a broken app.
   */
  hasPendingPrimaries: boolean;
  pagination: PaginationMeta;
}

/** One of the child's own assignments, with the task it belongs to and any evidence attached. */
export type MyAssignment = TaskAssignment & {
  task: Task;
  evidence: TaskEvidence[];
  team: TeamSummary | null;
};

export interface MyAssignmentsResponse {
  assignments: MyAssignment[];
  pagination: PaginationMeta;
}

export const CHILD_TASKS_PAGE_SIZE = 20;

export function fetchMyAssignments(page: number, signal?: AbortSignal): Promise<MyAssignmentsResponse> {
  // No childId parameter: the route reads it off the session for a child caller, so there is nothing
  // here that could be edited into another child's list.
  return api.get<MyAssignmentsResponse>(
    `/tasks/assignments/me?page=${page}&limit=${CHILD_TASKS_PAGE_SIZE}`,
    { signal }
  );
}

export function fetchAvailableTasks(page: number, signal?: AbortSignal): Promise<ChildTasksResponse> {
  return api.get<ChildTasksResponse>(`/tasks?page=${page}&limit=${CHILD_TASKS_PAGE_SIZE}`, { signal });
}

export const MY_ASSIGNMENTS_KEY = ['tasks', 'child', 'assignments'] as const;
export const AVAILABLE_TASKS_KEY = ['tasks', 'child', 'available'] as const;

/**
 * Everything a child's task action can change.
 *
 * Claiming or completing a task moves points, streak and goal progress on the dashboard, empties a slot
 * in the claimable pool, and changes the assignment list itself. Listing the three keys in one place is
 * the same reasoning as the parent side's `INVALIDATED_BY_APPROVAL`: invalidating only the list you are
 * standing on leaves the home tab quoting a stale points balance one tap away.
 */
export const INVALIDATED_BY_TASK_ACTION = [
  MY_ASSIGNMENTS_KEY,
  AVAILABLE_TASKS_KEY,
  CHILD_DASHBOARD_KEY,
] as const;

export function myAssignmentsQuery() {
  return {
    queryKey: MY_ASSIGNMENTS_KEY,
    queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
      fetchMyAssignments(pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last: MyAssignmentsResponse) =>
      last.pagination.hasMore ? last.pagination.page + 1 : undefined,
    // Presigned evidence URLs — see the module note.
    staleTime: 0,
  };
}

export function availableTasksQuery() {
  return {
    queryKey: AVAILABLE_TASKS_KEY,
    queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
      fetchAvailableTasks(pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last: ChildTasksResponse) =>
      last.pagination.hasMore ? last.pagination.page + 1 : undefined,
  };
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Move an assignment to `in_progress`.
 *
 * `startedAt` is deliberately not sent. The web passes a device timestamp to support its offline queue
 * (FR-13), where an action may be replayed minutes after the child performed it. Mobile is online-only
 * for writes in v1 — a locked product decision — so there is no gap to correct for, and sending a phone
 * clock the server then has to validate (a future timestamp is a 400) would add a failure mode for no
 * benefit. The server stamps its own time.
 */
export function startAssignment(assignmentId: string): Promise<unknown> {
  return api.put(`/tasks/assignments/${assignmentId}/start`, {});
}

/** Submit a completion. `note` becomes a `note` evidence row when present. */
export function completeAssignment(assignmentId: string, note?: string): Promise<unknown> {
  const trimmed = note?.trim();
  return api.put(`/tasks/assignments/${assignmentId}/complete`, trimmed ? { note: trimmed } : {});
}

/** Claim a task from the pool. Every guard is server-side; a 409 here is a real answer, not a bug. */
export function selfAssign(taskId: string): Promise<unknown> {
  return api.post('/tasks/assignments/self-assign', { taskId });
}
