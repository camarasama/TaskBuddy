/**
 * Dashboard reads.
 *
 * One caching subtlety is load-bearing here, so it lives with the fetcher rather than in a screen:
 * `pendingApprovals[].evidence` carries **presigned** URLs. Evidence has been private on R2 since F-4,
 * and the route signs those URLs per request with a short life. Cache the payload for long and the
 * photos in it start 403-ing while the surrounding data still looks fresh — which presents as "the
 * approval queue shows broken images sometimes", about the least debuggable bug shape there is.
 *
 * So this query opts out of the app's default 30s staleTime. `dashboardQuery` is the single place that
 * decision is expressed; screens use it rather than assembling their own options.
 */
import type { ParentDashboardResponse } from '@taskbuddy/shared';

import { api } from './api';

export function fetchParentDashboard(signal?: AbortSignal): Promise<ParentDashboardResponse> {
  return api.get<ParentDashboardResponse>('/dashboard/parent', { signal });
}

export const PARENT_DASHBOARD_KEY = ['dashboard', 'parent'] as const;

/**
 * Query options for the parent dashboard.
 *
 * `staleTime: 0` because of the presigned evidence URLs above — every mount refetches. The cost is one
 * request on a screen the user will look at anyway; the alternative is intermittently broken photos.
 */
export function dashboardQuery() {
  return {
    queryKey: PARENT_DASHBOARD_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchParentDashboard(signal),
    staleTime: 0,
  };
}
