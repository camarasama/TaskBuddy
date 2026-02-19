/**
 * jobs/streakAtRiskCron.ts — M9
 *
 * Runs at 18:00 (6pm) every day.
 * Finds all children who:
 *  - Have at least one pending/in_progress task assigned for today
 *  - Have completed 0 tasks today
 * Sends a 'streak_at_risk' email to the family's parent(s).
 *
 * "Today" is defined as: from midnight to end of day in UTC.
 * The cron only sends if the 'streak_at_risk' preference is enabled for the family.
 *
 * Usage — register in your main server file:
 *   import { startStreakAtRiskCron } from './jobs/streakAtRiskCron';
 *   startStreakAtRiskCron();
 */

import cron from 'node-cron';
import { prisma } from '../services/database';
import { EmailService } from '../services/email';

async function sendStreakAtRiskEmails(): Promise<void> {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);

  // Find all active children who have at least one active assignment today
  const childrenWithAssignments = await prisma.user.findMany({
    where: {
      role: 'child',
      isActive: true,
      deletedAt: null,
      taskAssignments: {
        some: {
          status: { in: ['pending', 'in_progress'] },
          // Assignment was due today or is ongoing (no dueDate filter — covers all active tasks)
        },
      },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      familyId: true,
      currentStreak: true,
      taskAssignments: {
        where: {
          status: 'completed',
          completedAt: { gte: startOfToday, lte: endOfToday },
        },
        select: { id: true },
      },
    },
  });

  // Filter to only those with 0 completions today
  const atRisk = childrenWithAssignments.filter(
    (child) => child.taskAssignments.length === 0,
  );

  console.log(`[streakAtRiskCron] Children at risk: ${atRisk.length}`);

  for (const child of atRisk) {
    const childName = `${child.firstName} ${child.lastName}`;

    try {
      await EmailService.sendToFamilyParents({
        familyId: child.familyId!,
        triggerType: 'streak_at_risk',
        subjectBuilder: () =>
          child.currentStreak > 0
            ? `${childName}'s ${child.currentStreak}-day streak is at risk today`
            : `${childName} hasn't completed any tasks today`,
        templateData: {
          childName,
          currentStreak: child.currentStreak ?? 0,
          childId: child.id,
        },
        referenceType: 'user',
        referenceId: child.id,
      });
    } catch (err: any) {
      console.error(
        `[streakAtRiskCron] Failed to send streak-at-risk email for child ${child.id}:`,
        err?.message,
      );
    }
  }
}

// ─── Cron entry point ─────────────────────────────────────────────────────────

export function startStreakAtRiskCron(): void {
  // Run at 18:00 every day
  cron.schedule('0 18 * * *', async () => {
    console.log('[streakAtRiskCron] Starting streak-at-risk scan...');
    try {
      await sendStreakAtRiskEmails();
      console.log('[streakAtRiskCron] Scan complete.');
    } catch (err: any) {
      console.error('[streakAtRiskCron] Unhandled error during scan:', err?.message);
    }
  });

  console.log('[streakAtRiskCron] Scheduled: daily at 18:00');
}
