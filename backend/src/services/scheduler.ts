/**
 * scheduler.ts — M6 (first creation)
 *
 * Central cron scheduler for TaskBuddy backend.
 * Call initScheduler() once from index.ts after the DB connection is ready.
 *
 * Jobs added in M6:
 *  - Nightly reward cleanup (00:05): deactivate expired and sold-out rewards
 *
 * Future jobs will be added here in later milestones:
 *  - M7: streak milestone bonus cron
 *  - M8: recurring task generation (BUG-03)
 *  - M9: email notification crons (task due soon, streak at risk, weekly digest)
 */

import cron from 'node-cron';
import { prisma } from './database';

// ─── Nightly reward cleanup ───────────────────────────────────────────────────

/**
 * deactivateExpiredAndExhaustedRewards
 *
 * Runs nightly at 00:05. Sets isActive = false for rewards that are:
 *   (a) past their expiresAt date, OR
 *   (b) fully claimed (non-cancelled redemption count >= maxRedemptionsTotal)
 *
 * This means the child-facing rewards list naturally hides these rewards when
 * filtered by active=true. The parent dashboard still shows them (inactive state).
 *
 * Acceptance test T1 verifies that after the 3rd redemption on a total-capped reward,
 * the nightly cron sets isActive = false.
 */
async function deactivateExpiredAndExhaustedRewards(): Promise<void> {
  const now = new Date();

  try {
    // ── Part 1: Expire by date ────────────────────────────────────────────────
    const expiredResult = await prisma.reward.updateMany({
      where: {
        isActive: true,
        deletedAt: null,
        expiresAt: { lte: now },
      },
      data: { isActive: false },
    });

    if (expiredResult.count > 0) {
      console.log(`[Scheduler] Deactivated ${expiredResult.count} expired reward(s)`);
    }

    // ── Part 2: Sold-out by total cap ─────────────────────────────────────────
    // Prisma doesn't support WHERE COUNT(relation) >= column in updateMany,
    // so we fetch candidates first, check the count, then update individually.
    const cappedCandidates = await prisma.reward.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        maxRedemptionsTotal: { not: null },
      },
      select: {
        id: true,
        maxRedemptionsTotal: true,
        _count: {
          select: {
            redemptions: {
              where: { status: { not: 'cancelled' } },
            },
          },
        },
      },
    });

    const soldOutIds = cappedCandidates
      .filter((r) => r._count.redemptions >= r.maxRedemptionsTotal!)
      .map((r) => r.id);

    if (soldOutIds.length > 0) {
      await prisma.reward.updateMany({
        where: { id: { in: soldOutIds } },
        data: { isActive: false },
      });
      console.log(`[Scheduler] Deactivated ${soldOutIds.length} sold-out reward(s)`);
    }
  } catch (error) {
    console.error('[Scheduler] Error in deactivateExpiredAndExhaustedRewards:', error);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * initScheduler
 *
 * Register all cron jobs. Call once from index.ts:
 *
 *   import { initScheduler } from './services/scheduler';
 *   initScheduler();
 */
export function initScheduler(): void {
  // Run at 00:05 every night (gives midnight DB writes a 5-minute buffer)
  cron.schedule('5 0 * * *', deactivateExpiredAndExhaustedRewards, {
    timezone: 'UTC',
  });

  console.log('[Scheduler] Cron jobs registered:');
  console.log('  00:05 UTC — Reward expiry & sold-out deactivation (M6)');
}
