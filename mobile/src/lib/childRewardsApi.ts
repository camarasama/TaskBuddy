/**
 * The child's reward shop.
 *
 * The child half of `GET /rewards`, promised in the note at the top of `rewardsApi.ts`. Same endpoint,
 * different payload: a child gets `wishlisted` (did *I* heart this) and a `remainingForChild` allowance,
 * where a parent gets the household `wishlistCount`. The cap and collaborative shapes are identical, so
 * they are imported from the parent module rather than restated.
 *
 * ## Three things a child can do to a reward, and they are not the same thing
 *
 * - **Wishlist** — "I want this." Free, idempotent, any number of rewards.
 * - **Goal** — "this is the one I'm saving for." At most one; pinning a second *moves* the pin. Drives
 *   the progress bar on the home tab.
 * - **Redeem** — spends the points. Irreversible from the child's side.
 *
 * They are deliberately separate calls rather than one "want" concept, because un-pinning a goal must
 * not un-wish the reward — a child who changes what they are saving for has not stopped wanting the
 * other thing.
 */
import type { Reward } from '@taskbuddy/shared';

import { api } from './api';
import { CHILD_DASHBOARD_KEY } from './childDashboardApi';
import type { CollaborativeProgress, RewardCaps, RewardRedemption } from './rewardsApi';
import type { PaginationMeta } from './tasksApi';

export type ChildReward = Reward &
  RewardCaps & {
    collaborative?: CollaborativeProgress;
    /** Whether *this* child has hearted it (FR-14). Absent on a parent payload. */
    wishlisted?: boolean;
  };

export interface ChildRewardsResponse {
  rewards: ChildReward[];
  pagination: PaginationMeta;
}

export type MyRedemption = RewardRedemption & { reward: Reward };

export interface MyRedemptionsResponse {
  redemptions: MyRedemption[];
  pagination: PaginationMeta;
}

export const CHILD_REWARDS_KEY = ['rewards', 'child', 'shop'] as const;
export const MY_REDEMPTIONS_KEY = ['rewards', 'child', 'redemptions'] as const;

/**
 * The shop.
 *
 * `active=true` because a child has no use for a reward a parent has switched off — it is not
 * purchasable and showing it reads as a tease. Parents keep the unfiltered view, which is how they see
 * what they have paused.
 */
export function fetchChildRewards(signal?: AbortSignal): Promise<ChildRewardsResponse> {
  return api.get<ChildRewardsResponse>('/rewards?active=true&page=1&limit=50', { signal });
}

export function fetchMyRedemptions(signal?: AbortSignal): Promise<MyRedemptionsResponse> {
  return api.get<MyRedemptionsResponse>('/rewards/redemptions/history?page=1&limit=50', { signal });
}

export function childRewardsQuery() {
  return {
    queryKey: CHILD_REWARDS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchChildRewards(signal),
  };
}

export function myRedemptionsQuery() {
  return {
    queryKey: MY_REDEMPTIONS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchMyRedemptions(signal),
  };
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Heart or un-heart. Both directions are idempotent server-side, so a double tap is harmless. */
export function setWishlisted(rewardId: string, wishlisted: boolean): Promise<unknown> {
  return wishlisted
    ? api.put(`/rewards/${rewardId}/wishlist`, {})
    : api.delete(`/rewards/${rewardId}/wishlist`);
}

/** Pin as the one thing being saved for. Pinning a different reward moves the pin; there is no list. */
export function setGoal(rewardId: string): Promise<unknown> {
  return api.put(`/rewards/${rewardId}/goal`, {});
}

/**
 * Un-pin.
 *
 * Note the path: `/rewards/goal/current`, not `/rewards/:id/goal`. There is only ever one goal, so the
 * delete does not need to name it — and a route with an id would invite the client to guess which one
 * is pinned instead of reading it off the dashboard.
 */
export function clearGoal(): Promise<unknown> {
  return api.delete('/rewards/goal/current');
}

/** Spend the points. Every guard — balance, caps, expiry, sold-out — is server-side. */
export function redeem(rewardId: string): Promise<unknown> {
  return api.post(`/rewards/${rewardId}/redeem`, {});
}

/**
 * Keys any of the three actions invalidates.
 *
 * The dashboard is in the list because all three can move it: redeeming changes the points balance,
 * pinning changes the goal bar, and un-pinning removes it. The redemptions list is there because
 * redeeming adds a row to it. Wishlisting alone touches only the catalogue, but the cost of
 * invalidating three cached lists on a tap is a few hundred bytes and the cost of getting it wrong is a
 * child staring at a points balance that did not move after they spent it.
 */
export const INVALIDATED_BY_REWARD_ACTION = [
  CHILD_REWARDS_KEY,
  MY_REDEMPTIONS_KEY,
  CHILD_DASHBOARD_KEY,
] as const;

/**
 * Can this child redeem it right now, and if not, why?
 *
 * Returns null when redemption is fine. The server is still the authority — this only decides what to
 * put on the button, so that a disabled control always carries its reason. Getting this wrong shows a
 * child an enabled button that then 409s, which is worse than an honest "not enough points yet".
 */
export function redeemBlockedReason(reward: ChildReward, pointsBalance: number): string | null {
  if (reward.isExpired) return 'This one has expired.';
  if (reward.isSoldOut) return 'All gone.';
  if (reward.remainingForChild === 0) return 'You’ve had this one already.';
  if (pointsBalance < reward.pointsCost) {
    return `${reward.pointsCost - pointsBalance} more points needed.`;
  }
  return null;
}
