/**
 * services/StreakShieldService.ts — buying streak insurance with points (growth roadmap §11.4).
 *
 * Shields already existed as something a child EARNS: one per 7-day milestone, capped at
 * `MAX_STREAK_FREEZES`, spent automatically to cover a missed day (§4.3). This adds the second way
 * to get one, and nothing else about them changes: same cap, same bank, same all-or-nothing spending
 * when a gap arrives.
 *
 * ## Why this is a second points sink, and why that is the point
 *
 * Rewards depend on a parent actually delivering something in the real world. When they are slow,
 * points stop meaning anything and the loop stalls. Cosmetics (§4.4) were the first answer to that;
 * a shield is the second, and it is the one a child can justify to themselves — it protects a thing
 * they have already invested weeks in.
 *
 * ## The cap is not optional
 *
 * Buying tops up TOWARD `MAX_STREAK_FREEZES`; it does not raise it. Without that, a child with a
 * large balance becomes streak-immune and the streak stops carrying any information about what they
 * actually did, which is the whole reason it exists.
 *
 * ## Everything is in-app points
 *
 * There is no real-money path here and there must never be one — binding under the ethics
 * guardrails for a children's product, the same rule `routes/cosmetics.ts` states.
 */

import { STREAK_SHIELD_COST } from '@taskbuddy/shared';

import { prisma } from './database';
// The cap lives with the earn/spend arithmetic in streakService rather than in shared, because it is
// a rule about how the bank behaves rather than a number a child reads on a button.
import { MAX_STREAK_FREEZES } from './streakService';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler';

export interface ShieldStatus {
  /** Shields banked right now. */
  owned: number;
  /** The ceiling. Buying tops up toward it and never past it. */
  max: number;
  cost: number;
  pointsBalance: number;
  /** False when at the cap OR short of points, so the UI does not have to re-derive the rule. */
  canBuy: boolean;
  /** Populated only when `canBuy` is false, so the button can say why in the child's own terms. */
  reason: 'at_cap' | 'not_enough_points' | null;
}

export async function status(childId: string): Promise<ShieldStatus> {
  const profile = await prisma.childProfile.findUnique({
    where: { userId: childId },
    select: { streakFreezes: true, pointsBalance: true },
  });
  if (!profile) throw new NotFoundError('Child profile not found');

  const atCap = profile.streakFreezes >= MAX_STREAK_FREEZES;
  const tooPoor = profile.pointsBalance < STREAK_SHIELD_COST;

  return {
    owned: profile.streakFreezes,
    max: MAX_STREAK_FREEZES,
    cost: STREAK_SHIELD_COST,
    pointsBalance: profile.pointsBalance,
    canBuy: !atCap && !tooPoor,
    // Cap first: at the cap, more points would not help, so saying "you need 12 more points" there
    // would send a child off to earn points that change nothing.
    reason: atCap ? 'at_cap' : tooPoor ? 'not_enough_points' : null,
  };
}

/**
 * Buy one shield.
 *
 * ## Why this is a conditional UPDATE rather than read-then-write
 *
 * `CosmeticService.purchase` reads the balance outside its transaction and trusts it inside. That is
 * survivable for cosmetics, where the second buy of the same item is caught by a unique constraint.
 * It is NOT survivable here: shields are fungible, so two requests arriving together would both read
 * the same balance, both pass the check, and both charge — spending 80 points on a bank the cap says
 * can only hold two. A child with two devices, or one impatient double-tap on a slow connection, is
 * enough to hit it.
 *
 * So the preconditions live in the `where` clause and the database enforces them. `updateMany`
 * returns the number of rows it touched: exactly 1 means this call won and the points are spent,
 * 0 means a concurrent buy got there first and nothing happened. The follow-up read is only to work
 * out WHICH precondition failed so the error can say something true.
 */
export async function purchase(childId: string): Promise<{
  pointsSpent: number;
  newBalance: number;
  owned: number;
}> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.childProfile.updateMany({
      where: {
        userId: childId,
        pointsBalance: { gte: STREAK_SHIELD_COST },
        streakFreezes: { lt: MAX_STREAK_FREEZES },
      },
      data: {
        pointsBalance: { decrement: STREAK_SHIELD_COST },
        streakFreezes: { increment: 1 },
      },
    });

    if (claimed.count === 0) {
      // Lost the race, or never qualified. Re-read to say which, in words a child can act on.
      const after = await tx.childProfile.findUnique({
        where: { userId: childId },
        select: { streakFreezes: true, pointsBalance: true },
      });
      if (!after) throw new NotFoundError('Child profile not found');

      if (after.streakFreezes >= MAX_STREAK_FREEZES) {
        throw new ConflictError(
          `You already have ${MAX_STREAK_FREEZES} streak savers, which is the most you can keep.`,
        );
      }
      const short = STREAK_SHIELD_COST - after.pointsBalance;
      throw new ValidationError(`You need ${short} more point${short === 1 ? '' : 's'} for this.`);
    }

    const after = await tx.childProfile.findUnique({
      where: { userId: childId },
      select: { streakFreezes: true, pointsBalance: true },
    });
    if (!after) throw new NotFoundError('Child profile not found');

    // Same shape as a reward redemption and a cosmetic unlock: negative amount, the balance after,
    // and a reference to what it bought. `redeemed` rather than a new TransactionType, matching
    // cosmetics — a new enum value would need a migration to say nothing new.
    await tx.pointsLedger.create({
      data: {
        childId,
        transactionType: 'redeemed',
        pointsAmount: -STREAK_SHIELD_COST,
        balanceAfter: after.pointsBalance,
        referenceType: 'streak_shield',
        referenceId: childId, // self-reference: a shield is a counter, not a row of its own
        description: 'Bought a streak saver',
      },
    });

    return {
      pointsSpent: STREAK_SHIELD_COST,
      newBalance: after.pointsBalance,
      owned: after.streakFreezes,
    };
  });
}
