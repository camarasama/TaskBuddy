/**
 * Streak shields, the child's second points sink (growth roadmap §11.4).
 *
 * A shield covers one missed day automatically when a gap arrives. They have always been earnable,
 * one per 7-day streak; this is the buy route to the same bank, and the cap is unchanged.
 *
 * Everything here is in-app points earned from tasks. There is no real-money path and there must
 * never be one, which is why this file talks only to `/streak-shields` and never to a store.
 *
 * The server decides `canBuy` and why not, rather than the screen re-deriving "at the cap OR short
 * of points" from two numbers. One rule, one place: a button that says "not enough points" while the
 * server would have said "you're full" is a small lie a child will notice.
 */
import { api } from './api';

import { CHILD_DASHBOARD_KEY } from './childDashboardApi';

export interface ShieldStatus {
  owned: number;
  max: number;
  cost: number;
  pointsBalance: number;
  canBuy: boolean;
  reason: 'at_cap' | 'not_enough_points' | null;
}

export const STREAK_SHIELDS_KEY = ['streak-shields'] as const;

export function shieldsQuery() {
  return {
    queryKey: STREAK_SHIELDS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      api.get<ShieldStatus>('/streak-shields', { signal }),
    // The balance moves whenever a task is approved, so a cached affordability flag goes wrong in
    // the direction that matters: it offers a buy the server will refuse.
    staleTime: 0,
  };
}

export async function buyShield(): Promise<{
  pointsSpent: number;
  newBalance: number;
  owned: number;
}> {
  return api.post('/streak-shields/buy');
}

/** Buying moves the points balance and the shield count, both of which the home screen shows. */
export const INVALIDATED_BY_SHIELD_PURCHASE = [STREAK_SHIELDS_KEY, CHILD_DASHBOARD_KEY] as const;
