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
import { prisma } from './database';
import { createNotification } from '../routes/notifications';

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

  // ─── Nightly due-date enforcement (02:00 UTC) ──────────────────────────────
  cron.schedule('0 2 * * *', async () => {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    try {
      // (1) Expire overdue assigned tasks
      const overdueAssignments = await prisma.taskAssignment.findMany({
        where: {
          status: { in: ['pending', 'in_progress'] },
          task: { dueDate: { lt: now } },
        },
        include: {
          task: { select: { id: true, title: true, familyId: true, dueDate: true } },
        },
      });

      for (const a of overdueAssignments) {
        await prisma.taskAssignment.update({
          where: { id: a.id },
          data: { status: 'expired' },
        });
        await createNotification({
          userId: a.childId,
          notificationType: 'task_expired',
          title: 'Task Expired',
          message: `"${a.task.title}" has expired without completion.`,
        });
        const parents = await prisma.user.findMany({
          where: { familyId: a.task.familyId, role: 'parent', deletedAt: null },
          select: { id: true },
        });
        for (const p of parents) {
          await createNotification({
            userId: p.id,
            notificationType: 'task_expired',
            title: 'Task Expired',
            message: `"${a.task.title}" expired without completion.`,
          });
        }
      }

      // (2) 24h expiry warning — only for assignments not yet warned
      const expiringAssignments = await prisma.taskAssignment.findMany({
        where: {
          status: { in: ['pending', 'in_progress'] },
          emailSentAt: null,
          task: { dueDate: { gte: now, lte: in24h } },
        },
        include: {
          task: { select: { id: true, title: true, dueDate: true } },
        },
      });

      for (const a of expiringAssignments) {
        await createNotification({
          userId: a.childId,
          notificationType: 'task_expiring',
          title: 'Task Due Soon',
          message: `"${a.task.title}" is due within 24 hours.`,
        });
        await prisma.taskAssignment.update({
          where: { id: a.id },
          data: { emailSentAt: now },
        });
      }

      // (3) Archive unassigned tasks past due date
      await prisma.task.updateMany({
        where: {
          status: 'active',
          dueDate: { lt: now },
          assignments: { none: {} },
        },
        data: { status: 'archived' },
      });

      console.log(`[Scheduler] Due-date cron: expired=${overdueAssignments.length}, warned=${expiringAssignments.length}`);
    } catch (error) {
      console.error('[Scheduler] Error in due-date cron:', error);
    }
  }, { timezone: 'UTC' });

  console.log('[Scheduler] Cron jobs registered:');
  console.log('  00:05 UTC — Reward expiry & sold-out deactivation (M6)');
  console.log('  02:00 UTC — Due-date enforcement: expire/warn/archive (PC item 8)');
}
