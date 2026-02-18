/**
 * rewardCaps.ts — M6 (CR-11)
 *
 * Isolated three-gate redemption guard. Called by the redeem route before
 * any points are deducted. Returns { allowed: true } or { allowed: false, reason, statusCode }.
 *
 * Gate order matters — check expiry first so the child gets the most specific error:
 *   Gate 1: expiresAt     → "This reward has expired."
 *   Gate 2: total cap     → "This reward has been fully claimed by the household."
 *   Gate 3: per-child cap → "You have already claimed this reward the maximum number of times."
 */

import { prisma } from '../services/database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CapCheckResult {
  allowed: boolean;
  reason?: string;
  // HTTP status to send back — always 409 Conflict for cap violations
  statusCode?: 409;
}

// Computed fields returned by getRewardWithCapData (appended to GET responses)
export interface RewardCapData {
  totalRedemptionsUsed: number;
  remainingTotal: number | null;   // null = no cap set
  remainingForChild: number | null; // null = no cap set
  isExpired: boolean;
  isSoldOut: boolean;
}

// ─── Main guard ───────────────────────────────────────────────────────────────

/**
 * checkRedemptionCaps
 *
 * @param rewardId  - the reward being redeemed
 * @param childId   - the child attempting the redemption
 * @param reward    - pre-fetched reward object (avoids an extra DB round-trip)
 * @returns CapCheckResult
 */
export async function checkRedemptionCaps(
  rewardId: string,
  childId: string,
  reward: {
    expiresAt: Date | null;
    maxRedemptionsTotal: number | null;
    maxRedemptionsPerChild: number | null;
  }
): Promise<CapCheckResult> {

  // ── Gate 1: Expiry ──────────────────────────────────────────────────────────
  // Check this explicitly so we return a specific "expired" message rather than
  // silently falling through to a 404. The redeem route no longer filters by
  // expiresAt in the findFirst query — it fetches the reward unconditionally and
  // delegates all cap logic here.
  if (reward.expiresAt && reward.expiresAt <= new Date()) {
    return {
      allowed: false,
      reason: 'This reward has expired.',
      statusCode: 409,
    };
  }

  // ── Gate 2: Household total cap ─────────────────────────────────────────────
  if (reward.maxRedemptionsTotal !== null && reward.maxRedemptionsTotal !== undefined) {
    const totalUsed = await prisma.rewardRedemption.count({
      where: {
        rewardId,
        status: { not: 'cancelled' },
      },
    });

    if (totalUsed >= reward.maxRedemptionsTotal) {
      return {
        allowed: false,
        reason: 'This reward has been fully claimed by the household.',
        statusCode: 409,
      };
    }
  }

  // ── Gate 3: Per-child cap ───────────────────────────────────────────────────
  if (reward.maxRedemptionsPerChild !== null && reward.maxRedemptionsPerChild !== undefined) {
    const childUsed = await prisma.rewardRedemption.count({
      where: {
        rewardId,
        childId,
        status: { not: 'cancelled' },
      },
    });

    if (childUsed >= reward.maxRedemptionsPerChild) {
      return {
        allowed: false,
        reason: 'You have already claimed this reward the maximum number of times.',
        statusCode: 409,
      };
    }
  }

  return { allowed: true };
}

// ─── Computed cap data for GET responses ──────────────────────────────────────

/**
 * getRewardCapData
 *
 * Calculates the computed fields that are appended to every reward returned
 * by GET /rewards and GET /rewards/:id. Lets the frontend show accurate
 * "Sold Out", "Expired", and remaining-count data without extra API calls.
 *
 * @param rewardId   - reward to compute data for
 * @param childId    - requesting child's userId (used for remainingForChild)
 * @param reward     - pre-fetched reward fields
 */
export async function getRewardCapData(
  rewardId: string,
  childId: string | null,
  reward: {
    maxRedemptionsTotal: number | null;
    maxRedemptionsPerChild: number | null;
    expiresAt: Date | null;
    isActive: boolean;
  }
): Promise<RewardCapData> {

  // Count all non-cancelled redemptions for this reward
  const totalRedemptionsUsed = await prisma.rewardRedemption.count({
    where: {
      rewardId,
      status: { not: 'cancelled' },
    },
  });

  // Count this specific child's redemptions (only relevant for child-facing calls)
  let childRedemptionsUsed = 0;
  if (childId && reward.maxRedemptionsPerChild !== null) {
    childRedemptionsUsed = await prisma.rewardRedemption.count({
      where: {
        rewardId,
        childId,
        status: { not: 'cancelled' },
      },
    });
  }

  const now = new Date();
  const isExpired = reward.expiresAt !== null && reward.expiresAt <= now;
  const isSoldOut =
    reward.maxRedemptionsTotal !== null &&
    totalRedemptionsUsed >= reward.maxRedemptionsTotal;

  return {
    totalRedemptionsUsed,
    remainingTotal:
      reward.maxRedemptionsTotal !== null
        ? Math.max(0, reward.maxRedemptionsTotal - totalRedemptionsUsed)
        : null,
    remainingForChild:
      reward.maxRedemptionsPerChild !== null && childId !== null
        ? Math.max(0, reward.maxRedemptionsPerChild - childRedemptionsUsed)
        : null,
    isExpired,
    isSoldOut,
  };
}
