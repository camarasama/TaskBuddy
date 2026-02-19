/**
 * jobs/expiryEmailCron.ts — M9
 *
 * Runs at midnight (00:05) every day.
 * Scans task assignments in two passes:
 *
 *  Pass 1 — Expiring soon (due within 24 h, not yet submitted, emailSentAt not set)
 *    → Send 'task_expiring' email to family parents
 *    → Set emailSentAt on the assignment to prevent duplicate sends
 *
 *  Pass 2 — Expired (past dueDate, still pending/in_progress, not yet notified)
 *    → Send 'task_expired' email to family parents
 *    → Set emailSentAt (reuses the same field; only one email type per assignment)
 *
 * The emailSentAt field added in the M9 schema migration is the deduplication guard.
 * Once set, neither pass will re-process the same assignment (T2 requirement).
 *
 * Usage — register in your main server file:
 *   import { startExpiryEmailCron } from './jobs/expiryEmailCron';
 *   startExpiryEmailCron();
 */

import cron from 'node-cron';
import { prisma } from '../services/database';
import { EmailService } from '../services/email';

// ─── Pass 1: expiring soon ────────────────────────────────────────────────────

async function sendExpiryWarnings(): Promise<void> {
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Find assignments due within 24 h, not yet completed/rejected, not yet emailed
  const assignments = await prisma.taskAssignment.findMany({
    where: {
      status: { in: ['pending', 'in_progress'] },
      dueDate: { gt: now, lte: in24h },
      emailSentAt: null,
    },
    include: {
      task: { select: { title: true, familyId: true } },
      child: { select: { firstName: true, lastName: true } },
    },
  });

  console.log(`[expiryEmailCron] Expiring soon: ${assignments.length} assignment(s)`);

  for (const assignment of assignments) {
    const childName = `${assignment.child.firstName} ${assignment.child.lastName}`;
    const taskTitle = assignment.task.title;
    const familyId = assignment.task.familyId;

    try {
      await EmailService.sendToFamilyParents({
        familyId,
        triggerType: 'task_expiring',
        subjectBuilder: () => `Task expiring soon: "${taskTitle}" for ${childName}`,
        templateData: {
          childName,
          taskTitle,
          dueAt: assignment.dueDate,
          assignmentId: assignment.id,
        },
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      });

      // Mark as emailed to prevent duplicate on next cron run (T2 requirement)
      await prisma.taskAssignment.update({
        where: { id: assignment.id },
        data: { emailSentAt: new Date() },
      });
    } catch (err: any) {
      console.error(
        `[expiryEmailCron] Failed to send expiry warning for assignment ${assignment.id}:`,
        err?.message,
      );
      // Do NOT set emailSentAt — allow retry on next cron run
    }
  }
}

// ─── Pass 2: already expired ─────────────────────────────────────────────────

async function sendExpiredDigest(): Promise<void> {
  const now = new Date();

  // Find assignments past their due date, still pending/in_progress, not yet emailed
  const assignments = await prisma.taskAssignment.findMany({
    where: {
      status: { in: ['pending', 'in_progress'] },
      dueDate: { lt: now },
      emailSentAt: null,
    },
    include: {
      task: { select: { title: true, familyId: true } },
      child: { select: { firstName: true, lastName: true } },
    },
  });

  console.log(`[expiryEmailCron] Expired (not notified): ${assignments.length} assignment(s)`);

  for (const assignment of assignments) {
    const childName = `${assignment.child.firstName} ${assignment.child.lastName}`;
    const taskTitle = assignment.task.title;
    const familyId = assignment.task.familyId;

    try {
      await EmailService.sendToFamilyParents({
        familyId,
        triggerType: 'task_expired',
        subjectBuilder: () => `Task expired: "${taskTitle}" for ${childName}`,
        templateData: {
          childName,
          taskTitle,
          dueAt: assignment.dueDate,
          assignmentId: assignment.id,
        },
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      });

      await prisma.taskAssignment.update({
        where: { id: assignment.id },
        data: { emailSentAt: new Date() },
      });
    } catch (err: any) {
      console.error(
        `[expiryEmailCron] Failed to send expired notification for assignment ${assignment.id}:`,
        err?.message,
      );
    }
  }
}

// ─── Cron entry point ─────────────────────────────────────────────────────────

export function startExpiryEmailCron(): void {
  // Run at 00:05 every day — 5-minute offset avoids exact-midnight DB load spikes
  cron.schedule('5 0 * * *', async () => {
    console.log('[expiryEmailCron] Starting expiry email scan...');
    try {
      await sendExpiryWarnings();
      await sendExpiredDigest();
      console.log('[expiryEmailCron] Scan complete.');
    } catch (err: any) {
      console.error('[expiryEmailCron] Unhandled error during scan:', err?.message);
    }
  });

  console.log('[expiryEmailCron] Scheduled: daily at 00:05');
}
