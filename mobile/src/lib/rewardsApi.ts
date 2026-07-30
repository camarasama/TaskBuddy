/**
 * Rewards, from the parent's side.
 *
 * Two different things live behind one screen, and only one of them is urgent:
 *
 *   - **Redemptions awaiting fulfilment.** A child has already spent their points; the parent owes
 *     them the actual thing. That is a promise outstanding, so it comes first.
 *   - **The catalogue.** Reference material — what exists, what it costs, what is capped or sold out.
 *
 * As with `/tasks`, `GET /rewards` returns a different payload depending on who asks: a child gets
 * `wishlisted` and their own remaining allowance, a parent gets the household `wishlistCount`. Only the
 * parent shape is modelled here; the child's reward shop is Phase 2.
 */
import type { RedemptionStatus, Reward, User } from '@taskbuddy/shared';

import { api } from './api';
import type { PaginationMeta } from './tasksApi';

/**
 * The redemption entity, declared here because `shared` does not model it.
 *
 * Shared exports `RedemptionStatus` and a `RewardRedemptionRow` for the reports feature, but no type for
 * the row this endpoint actually returns — so this mirrors `model RewardRedemption` in
 * `backend/prisma/schema.prisma`. Same gap as `PaginationMeta` in `tasksApi.ts`; both would be worth
 * lifting into shared together rather than one at a time.
 *
 * Dates are typed as `string` rather than `Date` on purpose. That is what JSON delivers, and shared's
 * habit of annotating them as `Date` is exactly the trap `lib/dates.ts` exists to absorb — no reason to
 * reproduce it in a type written today.
 */
export interface RewardRedemption {
  id: string;
  rewardId: string;
  childId: string;
  pointsSpent: number;
  status: RedemptionStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  fulfilledAt?: string | null;
  /** Set only for a collaborative reward with a `parent_choice` rule; null means shared. */
  recipientChildId?: string | null;
  notes?: string | null;
  createdAt: string;
}

/**
 * Computed cap fields the route appends via `getRewardCapData()`.
 *
 * `null` means "no cap set" for both remaining counts — distinct from `0`, which means the cap is
 * reached. Conflating them would show "0 left" on an unlimited reward.
 */
export interface RewardCaps {
  totalRedemptionsUsed: number;
  remainingTotal: number | null;
  remainingForChild: number | null;
  isExpired: boolean;
  isSoldOut: boolean;
}

/** FR-09 pooled progress, present only on collaborative rewards. */
export interface CollaborativeProgress {
  pooled: number;
  goal: number;
  funded: boolean;
}

export type ParentReward = Reward &
  RewardCaps & {
    creator: { id: string; firstName: string; lastName: string };
    collaborative?: CollaborativeProgress;
    /** Household total — how many children have hearted it (FR-14). Parents only. */
    wishlistCount?: number;
  };

export interface ParentRewardsResponse {
  rewards: ParentReward[];
  pagination: PaginationMeta;
}

export type Redemption = RewardRedemption & {
  reward: Reward;
  child: Pick<User, 'id' | 'firstName' | 'lastName'>;
};

export interface RedemptionsResponse {
  redemptions: Redemption[];
  pagination: PaginationMeta;
}

export const REWARDS_KEY = ['rewards', 'catalogue'] as const;
export const REDEMPTIONS_KEY = ['rewards', 'redemptions'] as const;

export function fetchRewards(signal?: AbortSignal): Promise<ParentRewardsResponse> {
  return api.get<ParentRewardsResponse>('/rewards?page=1&limit=50', { signal });
}

export function fetchRedemptions(signal?: AbortSignal): Promise<RedemptionsResponse> {
  return api.get<RedemptionsResponse>('/rewards/redemptions/history?page=1&limit=50', { signal });
}

export function rewardsQuery() {
  return {
    queryKey: REWARDS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchRewards(signal),
  };
}

export function redemptionsQuery() {
  return {
    queryKey: REDEMPTIONS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchRedemptions(signal),
  };
}

/**
 * Redemptions the parent still owes.
 *
 * `pending` and `approved` both mean "points spent, thing not yet handed over" — `approved` is the
 * intermediate state where a parent has agreed but not delivered. Filtering to `pending` alone would
 * silently hide half the outstanding promises.
 */
export function outstanding(redemptions: Redemption[]): Redemption[] {
  return redemptions.filter((r) => r.status === 'pending' || r.status === 'approved');
}

/** Mark a redemption delivered. Parents only; the route enforces it. */
export function fulfilRedemption(redemptionId: string): Promise<{ redemption: RewardRedemption }> {
  return api.put<{ redemption: RewardRedemption }>(
    `/rewards/redemptions/${redemptionId}/fulfill`,
    {}
  );
}

/**
 * Keys a fulfilment invalidates.
 *
 * The redemption list obviously, and the catalogue because `totalRedemptionsUsed` and the sold-out flag
 * move with it. Points are *not* refunded by fulfilling, so the dashboard's totals do not change — which
 * is why it is deliberately absent here rather than swept in for safety.
 */
export const INVALIDATED_BY_FULFILMENT = [REDEMPTIONS_KEY, REWARDS_KEY] as const;
