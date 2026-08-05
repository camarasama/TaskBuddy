/**
 * services/GoalService.ts — "I'm saving for…" (growth roadmap §4.2).
 *
 * The goal-gradient effect: completion rates rise as a progress bar fills, so giving a child one
 * visible thing they are working toward is worth more than a longer list of things they might want.
 *
 * **Re-costed from the roadmap.** §4.2 specified a new `ChildGoal` model, which was written before
 * FR-14 shipped the wishlist. The wishlist already captures which reward a child wants, so this is a
 * flag on that table plus a derived progress figure — not a new model, and not a stored counter.
 *
 * Progress is DERIVED from the live points balance every time it is read. A stored "progress" column
 * would drift the moment points were spent, refunded, or reversed by the FR-03 revoke flow.
 */

import type { ChildGoal } from '@taskbuddy/shared';

import { prisma } from './database';
import { NotFoundError } from '../middleware/errorHandler';

/** Fallback when a child has no completed tasks to average — the seed packs' median. */
const DEFAULT_POINTS_PER_TASK = 15;

/**
 * Re-exported, not re-declared. The shape is part of the child dashboard's response contract, so it
 * lives in `shared` where the web and mobile clients read the same definition — this file used to hold
 * one of three identical copies. Imported *and* re-exported because `export … from` alone creates no
 * local binding, and `getGoal` below annotates its return with it.
 */
export type { ChildGoal };

/**
 * Estimate how many more tasks the child needs.
 *
 * Uses the child's OWN average award rather than a global constant, so a family that awards 50 a
 * task does not get told "12 tasks to go" when the honest answer is 4.
 */
export function estimateTasksToGo(pointsNeeded: number, avgPointsPerTask: number): number {
  if (pointsNeeded <= 0) return 0;
  const rate = avgPointsPerTask > 0 ? avgPointsPerTask : DEFAULT_POINTS_PER_TASK;
  return Math.max(1, Math.ceil(pointsNeeded / rate));
}

/** Clamped percentage. */
export function goalPercent(balance: number, cost: number): number {
  if (cost <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((balance / cost) * 100)));
}

/**
 * Pin a wishlist reward as the child's goal.
 *
 * Moves the pin rather than adding a second: at most one goal per child, cleared and set in one
 * transaction so a failure cannot leave a child with two pins or none.
 *
 * Adds the reward to the wishlist if it is not already there — a child pinning something they have
 * not hearted yet clearly wants it, and making them do both would be pointless ceremony.
 */
export async function setGoal(params: {
  childId: string;
  familyId: string;
  rewardId: string;
}): Promise<ChildGoal> {
  const { childId, familyId, rewardId } = params;

  const reward = await prisma.reward.findFirst({
    where: { id: rewardId, familyId, deletedAt: null },
  });
  if (!reward) throw new NotFoundError('Reward not found');

  await prisma.$transaction(async (tx) => {
    await tx.rewardWishlist.updateMany({
      where: { childId, isGoal: true },
      data: { isGoal: false },
    });
    await tx.rewardWishlist.upsert({
      where: { rewardId_childId: { rewardId, childId } },
      create: { rewardId, childId, isGoal: true },
      update: { isGoal: true },
    });
  });

  const goal = await getGoal(childId);
  if (!goal) throw new NotFoundError('Goal could not be set');
  return goal;
}

/** Un-pin. The wishlist entry survives — un-pinning is not un-wanting. */
export async function clearGoal(childId: string): Promise<void> {
  await prisma.rewardWishlist.updateMany({
    where: { childId, isGoal: true },
    data: { isGoal: false },
  });
}

/** The child's current goal with live progress, or null. */
export async function getGoal(childId: string): Promise<ChildGoal | null> {
  const pinned = await prisma.rewardWishlist.findFirst({
    where: { childId, isGoal: true },
    include: { reward: true },
  });
  if (!pinned || pinned.reward.deletedAt || !pinned.reward.isActive) return null;

  const profile = await prisma.childProfile.findUnique({
    where: { userId: childId },
    select: { pointsBalance: true },
  });
  const pointsBalance = profile?.pointsBalance ?? 0;
  const pointsNeeded = Math.max(0, pinned.reward.pointsCost - pointsBalance);

  // The child's own recent earning rate, so the estimate reflects how this family actually awards.
  const recent = await prisma.pointsLedger.aggregate({
    where: { childId, pointsAmount: { gt: 0 } },
    _avg: { pointsAmount: true },
  });

  return {
    rewardId: pinned.rewardId,
    name: pinned.reward.name,
    pointsCost: pinned.reward.pointsCost,
    pointsBalance,
    pointsNeeded,
    percent: goalPercent(pointsBalance, pinned.reward.pointsCost),
    tasksToGo: estimateTasksToGo(pointsNeeded, Math.round(recent._avg.pointsAmount ?? 0)),
  };
}

export const GoalService = { setGoal, clearGoal, getGoal, estimateTasksToGo, goalPercent };
