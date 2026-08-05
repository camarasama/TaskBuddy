/**
 * Child dashboard reads.
 *
 * The counterpart to `dashboardApi.ts`, and deliberately a separate module: the two endpoints share a
 * name and nothing else. `/dashboard/child` is scoped to the calling child by the server — there is no
 * child id in the path — so a child session can only ever fetch its own.
 *
 * ## Why this one may cache and the parent's may not
 *
 * `dashboardQuery` pins `staleTime: 0` because the parent payload carries **presigned** evidence URLs
 * that expire out from under a cached page. This payload does not: the child route includes evidence
 * rows but never signs them, and nothing rendered from here is an image fetched from R2. So the app's
 * default 30s staleTime applies, which matters on a phone — a child bouncing between tabs should not
 * re-request their own dashboard every time.
 *
 * If a future change starts rendering evidence photos on a child screen, that screen needs the parent
 * module's `staleTime: 0` treatment, not this one's.
 */
import type { ChildDashboardResponse } from '@taskbuddy/shared';

import { api } from './api';

export function fetchChildDashboard(signal?: AbortSignal): Promise<ChildDashboardResponse> {
  return api.get<ChildDashboardResponse>('/dashboard/child', { signal });
}

export const CHILD_DASHBOARD_KEY = ['dashboard', 'child'] as const;

/**
 * The single list of query keys anything a child *does* should invalidate.
 *
 * Completing a task changes the points balance, the streak, today's progress and possibly the goal
 * bar — all of which live on the dashboard rather than on the screen the child was looking at. Screens
 * import this rather than each remembering which keys their action touches, for the same reason
 * `INVALIDATED_BY_APPROVAL` exists on the parent side: invalidating only the list you are on leaves
 * the home tab confidently displaying a stale number.
 */
export const INVALIDATED_BY_CHILD_ACTION = [CHILD_DASHBOARD_KEY] as const;

export function childDashboardQuery() {
  return {
    queryKey: CHILD_DASHBOARD_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchChildDashboard(signal),
  };
}
