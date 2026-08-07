/**
 * jobs/expiryEmailCron.ts - M9
 *
 * Runs at midnight (00:05) every day.
 * Scans task assignments in two passes:
 *
 *  Pass 1 - Expiring soon (due within 24 h, not yet submitted, emailSentAt not set)
 *    → Send 'task_expiring' email to family parents
 *    → Set emailSentAt on the assignment to prevent duplicate sends
 *
 *  Pass 2 - Expired (past dueDate, still pending/in_progress, not yet notified)
 *    → Send 'task_expired' email to family parents
 *    → Set emailSentAt (reuses the same field; only one email type per assignment)
 *
 *  Pass 3 - Expire the row itself (instanceDate + grace has passed)
 *    → Flip status to 'expired'
 *
 * The emailSentAt field added in the M9 schema migration is the deduplication guard.
 * Once set, neither email pass will re-process the same assignment (T2 requirement).
 *
 * Pass 3 exists because passes 1 and 2 only ever *notified*: they set emailSentAt and left the row
 * `pending` forever. Two things broke as a result. A daily recurring task grew one stale pending
 * instance per elapsed day, so a child's list showed the same task over and over. And the pool-task
 * code (routes/taskSelfAssign.ts, routes/tasks.ts) decides claimability with `status !== 'expired'`
 * — with nothing ever writing that value, an abandoned claim locked its slot permanently and
 * claimsRemaining never recovered. Pass 3 is what makes that filter mean something.
 *
 * Note the emailSentAt guard deliberately does NOT gate pass 3: whether a parent was emailed is
 * unrelated to whether the day is over, and an email failure must not leave a row unexpirable.
 *
 * Usage - register in your main server file:
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
      task: { dueDate: { gt: now, lte: in24h } },
      emailSentAt: null,
    },
    include: {
      task: { select: { title: true, familyId: true, dueDate: true } },
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
          dueAt: assignment.task.dueDate,
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
      // Do NOT set emailSentAt - allow retry on next cron run
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
      task: { dueDate: { lt: now } },
      emailSentAt: null,
    },
    include: {
      task: { select: { title: true, familyId: true, dueDate: true } },
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
          dueAt: assignment.task.dueDate,
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

// ─── Pass 3: expire the assignment itself ────────────────────────────────────

/**
 * Judged on `instanceDate`, NOT `task.dueDate`.
 *
 * Every instance of a recurring task inherits the parent task's single dueDate, so dueDate cannot
 * tell yesterday's "Brush teeth" apart from today's — they are literally identical on that field,
 * which is why the whole backlog looked like one task repeated. `instanceDate` is a @db.Date holding
 * the day the instance is FOR, and is the only field that separates them.
 *
 * Only `pending` and `in_progress` are touched. `completed` and `approved` are finished work, and
 * expiring them would retroactively strip points a child has already been paid. `rejected` is a
 * parent's explicit verdict with a reason attached to it; overwriting that would erase what the
 * child was told and why.
 *
 * Day arithmetic is UTC. `instanceDate` is a DATE column, so Prisma returns it as midnight UTC;
 * comparing it against a locally-anchored midnight would shift the boundary by the server's offset
 * and expire a full day early or late. (streakService uses local-time midnight on purpose — it
 * compares wall-clock timestamps, not a date-only column. The two are not in conflict.)
 *
 * @param now Injectable clock so the boundary is testable without waiting for midnight.
 * @returns how many rows actually moved to 'expired'.
 */
export async function expireOverdueAssignments(now: Date = new Date()): Promise<number> {
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  // Nothing dated today or later can be expired under any grace period, so this bound is safe and
  // keeps the scan off the live set — which is most of the table on an active family.
  const candidates = await prisma.taskAssignment.findMany({
    where: {
      status: { in: ['pending', 'in_progress'] },
      instanceDate: { lt: startOfToday },
    },
    select: {
      id: true,
      instanceDate: true,
      task: { select: { familyId: true } },
    },
  });

  if (candidates.length === 0) {
    console.log('[expiryEmailCron] Expired 0 overdue assignment(s)');
    return 0;
  }

  // The grace period is per-family, so the cutoff has to be computed per family rather than once
  // globally. Group first, then fetch every relevant settings row in a single query.
  const byFamily = new Map<string, { id: string; instanceDate: Date }[]>();
  for (const candidate of candidates) {
    const list = byFamily.get(candidate.task.familyId) ?? [];
    list.push({ id: candidate.id, instanceDate: candidate.instanceDate });
    byFamily.set(candidate.task.familyId, list);
  }

  const settingsRows = await prisma.familySettings.findMany({
    where: { familyId: { in: Array.from(byFamily.keys()) } },
    select: { familyId: true, streakGracePeriodHours: true },
  });
  const graceByFamily = new Map<string, number>(
    settingsRows.map((s) => [s.familyId, s.streakGracePeriodHours]),
  );

  let expiredCount = 0;

  for (const [familyId, list] of byFamily) {
    // A family with no settings row has never opted into a grace period. 0 mirrors streakService's
    // fallback so the two features can never disagree about the same family's deadline.
    const graceHours = graceByFamily.get(familyId) ?? 0;

    // An instance for day D survives until midnight after D, PLUS the family's grace — the same
    // window that already lets a late-night finish still count towards the streak. Reusing it keeps
    // one promise rather than two: if grace saved the streak, it also saved the assignment.
    //
    // Rolling the clock back by the grace and then asking "which day is it?" gives the first day
    // that is fully past. Consequence worth knowing: with a non-zero grace this cron's 00:05 slot
    // is still inside yesterday's window, so yesterday expires on the following night's run. That
    // is correct — at 00:05 the grace genuinely has not elapsed.
    const cutoff = new Date(now.getTime() - graceHours * 60 * 60 * 1000);
    cutoff.setUTCHours(0, 0, 0, 0);

    const ids = list
      .filter((a) => a.instanceDate.getTime() < cutoff.getTime())
      .map((a) => a.id);
    if (ids.length === 0) continue;

    // The status filter is repeated on the write, not just the read. A child can submit or start a
    // task in the gap between the two, and expiring work that was just handed in would silently
    // destroy it.
    const result = await prisma.taskAssignment.updateMany({
      where: { id: { in: ids }, status: { in: ['pending', 'in_progress'] } },
      data: { status: 'expired' },
    });
    expiredCount += result.count;
  }

  console.log(`[expiryEmailCron] Expired ${expiredCount} overdue assignment(s)`);
  return expiredCount;
}

// ─── Cron entry point ─────────────────────────────────────────────────────────

export function startExpiryEmailCron(): void {
  // Run at 00:05 every day - 5-minute offset avoids exact-midnight DB load spikes
  cron.schedule('5 0 * * *', async () => {
    console.log('[expiryEmailCron] Starting expiry email scan...');
    try {
      await sendExpiryWarnings();
      await sendExpiredDigest();
      // Runs last on purpose: pass 2 selects on status pending/in_progress, so expiring first would
      // empty its result set and parents would stop being told their child's task lapsed.
      await expireOverdueAssignments();
      console.log('[expiryEmailCron] Scan complete.');
    } catch (err: any) {
      console.error('[expiryEmailCron] Unhandled error during scan:', err?.message);
    }
  });

  /**
   * Expiry ALSO runs hourly, and the daily pass above is not sufficient on its own.
   *
   * The grace period is measured from the end of the instance's day, and `streakGracePeriodHours`
   * defaults to 4 and may be set as high as 12. At 00:05 that grace has by definition not elapsed,
   * so the nightly run cannot expire the day that just ended — it would only be caught on the
   * *following* night, roughly 24 hours late. For a daily chore that means a child keeps seeing
   * yesterday's task all of today, which is the exact pile-up this whole change exists to stop.
   *
   * An hourly sweep closes it: an instance expires within the hour after its grace runs out,
   * whatever the family set. The query is a `updateMany` over an indexed
   * (`status`, `instanceDate`) predicate and no-ops when there is nothing to do, so the cost of
   * running it 24× a day rather than once is negligible.
   *
   * Emails deliberately stay on the nightly schedule — nobody wants an hourly "task expired" digest.
   */
  cron.schedule('20 * * * *', async () => {
    try {
      await expireOverdueAssignments();
    } catch (err: any) {
      console.error('[expiryEmailCron] Unhandled error during hourly expiry sweep:', err?.message);
    }
  });

  console.log('[expiryEmailCron] Scheduled: emails daily at 00:05, expiry sweep hourly at :20');
}
