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
import { RewardService } from './RewardService';

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
// ─── Init ─────────────────────────────────────────────────────────────────────

export function initScheduler(): void {
  cron.schedule('5 0 * * *', async () => {
    try {
      await RewardService.runNightlyExpiry();
    } catch (error) {
      console.error('[Scheduler] Error in nightly reward cleanup:', error);
    }
  }, { timezone: 'UTC' });

  console.log('[Scheduler] Cron jobs registered:');
  console.log('  00:05 UTC — Reward expiry & sold-out deactivation (M6)');
}
