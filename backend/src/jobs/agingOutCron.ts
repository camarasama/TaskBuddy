/**
 * jobs/agingOutCron.ts — flags children who have turned 18, and applies the deadline default.
 *
 * Follows the digestCron pattern: node-cron, one scan, per-item isolation so one family's bad data
 * cannot abort the run.
 *
 * Runs 06:00 UTC daily. Both halves are deliberately in one job and in this order:
 *
 *  1. Open transitions for anyone newly 18, and tell their parents.
 *  2. Expire anything past its deadline, applying the agreed default.
 *
 * Opening first means a birthday and an expiry landing on the same run cannot interleave oddly, and
 * a newly opened row can never be expired by the same pass because its deadline is 30 days out.
 *
 * Idempotent by construction: `findNewlyAged` excludes anyone who already has a transition row, and
 * the unique index on `childId` makes a concurrent double-run a constraint error rather than a
 * duplicate.
 */
import cron from 'node-cron';

import { prisma } from '../services/database';
import { EmailService } from '../services/email';
import { TransitionService } from '../services/TransitionService';

export async function runAgingOutSweep(now: Date = new Date()): Promise<{ opened: number; expired: number }> {
  let opened = 0;

  const newlyAged = await TransitionService.findNewlyAged(now);
  for (const child of newlyAged) {
    try {
      const transition = await TransitionService.openTransition(child, now);
      if (!transition || !child.familyId) continue;
      opened += 1;

      // Every adult on the account, not just the one who created the child. Either parent can
      // resolve it, and only telling one of them makes it that person's chore by accident.
      await EmailService.sendToFamilyParents({
        familyId: child.familyId,
        triggerType: 'aging_out',
        subjectBuilder: () => `${child.firstName} has turned 18`,
        templateData: {
          childFirstName: child.firstName,
          pointsBalance: child.childProfile?.pointsBalance ?? 0,
          deadlineDays: TransitionService.TRANSITION_DEADLINE_DAYS,
        },
        referenceType: 'account_transition',
        referenceId: transition.id,
      });
    } catch (err) {
      // One child failing must not stop the others being flagged.
      console.error('[agingOutCron] failed for child', child.id, (err as Error)?.message);
    }
  }

  const expired = await TransitionService.expireOverdue(now);

  if (opened || expired.length) {
    console.log(`[agingOutCron] opened ${opened}, expired ${expired.length}`);
  }
  return { opened, expired: expired.length };
}

export function startAgingOutCron(): void {
  cron.schedule('0 6 * * *', async () => {
    try {
      await runAgingOutSweep();
    } catch (err) {
      // A throw out of a cron callback takes the process down on some runtimes. The sweep is daily;
      // losing one run is recoverable, losing the server is not.
      console.error('[agingOutCron] sweep failed:', (err as Error)?.message);
    }
  });
}

/** Exported for the route that lets a parent see what is pending without waiting for the cron. */
export async function pendingTransitionsFor(familyId: string) {
  return prisma.accountTransition.findMany({
    where: { familyId, status: 'pending' },
    orderBy: { detectedAt: 'asc' },
  });
}
