/**
 * Task reads for the parent shell.
 *
 * `GET /tasks` returns a different payload depending on who asks — a child gets self-assign flags, a
 * claim count and team progress that a parent does not. Only the parent shape is modelled here; the
 * child variant belongs with the child screens in Phase 2, and conflating them into one optional-heavy
 * type would make both harder to read than having two.
 */
import type { Task, TaskAssignment } from '@taskbuddy/shared';

import { api } from './api';

/**
 * Matches `buildMeta()` in backend/src/utils/pagination.ts.
 *
 * Declared here rather than imported because that interface lives in the backend's utils, not in
 * `shared` — and shared's own `PaginatedResponse` describes a shape the API does not return (see the
 * note on it there). Worth consolidating one day; not worth blocking a screen on.
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

/** A task as the list endpoint returns it to a parent: with its creator and every assignment. */
export type ParentTask = Task & {
  creator: { id: string; firstName: string; lastName: string };
  assignments: (TaskAssignment & {
    child: { id: string; firstName: string; lastName: string; avatarUrl?: string | null };
  })[];
};

export interface ParentTasksResponse {
  tasks: ParentTask[];
  pagination: PaginationMeta;
}

export interface TaskFilters {
  /** Backend accepts only these three; anything else is rejected by its query schema. */
  status?: 'active' | 'paused' | 'archived';
  childId?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  category?: string;
}

function toQuery(filters: TaskFilters, page: number, limit: number): string {
  const params = new URLSearchParams();
  // Only set keys that have values — the backend's schema rejects an empty string for the enums
  // rather than treating it as "no filter".
  if (filters.status) params.set('status', filters.status);
  if (filters.childId) params.set('childId', filters.childId);
  if (filters.difficulty) params.set('difficulty', filters.difficulty);
  if (filters.category) params.set('category', filters.category);
  params.set('page', String(page));
  params.set('limit', String(limit));
  return params.toString();
}

export const TASKS_PAGE_SIZE = 20;

export function fetchParentTasks(
  filters: TaskFilters,
  page: number,
  signal?: AbortSignal
): Promise<ParentTasksResponse> {
  return api.get<ParentTasksResponse>(`/tasks?${toQuery(filters, page, TASKS_PAGE_SIZE)}`, {
    signal,
  });
}

export const TASKS_KEY = 'tasks';

/** Key includes the filters, so switching filter does not show the previous filter's cached page. */
export function tasksQueryKey(filters: TaskFilters) {
  return [TASKS_KEY, 'parent', filters] as const;
}

/**
 * Infinite-query options for the parent task list.
 *
 * Paged rather than fetch-everything because a family that has used this app for a year has hundreds
 * of tasks, and a phone renders that badly. `hasMore` from the server decides when to stop, rather
 * than the client comparing counts and getting it subtly wrong at boundaries.
 */
export function parentTasksQuery(filters: TaskFilters) {
  return {
    queryKey: tasksQueryKey(filters),
    queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
      fetchParentTasks(filters, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last: ParentTasksResponse) =>
      last.pagination.hasMore ? last.pagination.page + 1 : undefined,
  };
}
