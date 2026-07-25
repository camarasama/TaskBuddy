/**
 * jobs/digestCron.ts — the Monday weekly parent digest (growth roadmap §3.3, #2 priority).
 *
 * Clones the streakAtRiskCron pattern: node-cron, one scan, per-family isolation so one family's
 * failure cannot abort the run.
 *
 * Runs 07:00 UTC Monday. The roadmap asks for "Monday 7am local"; per-family local scheduling would
 * need either 24 hourly passes filtered by timezone or a per-family job, and FamilySettings.timezone
 * is not reliably populated today. A single 07:00 UTC pass is the honest version of that until
 * timezone data is trustworthy — recorded here rather than silently claiming local delivery.
 *
 * Register in the server entry point:
 *   import { startDigestCron } from './jobs/digestCron';
 *   startDigestCron();
 */

import cron from 'node-cron';
import { prisma } from '../services/database';
import { EmailService } from '../services/email';
import { AnalyticsService } from '../services/AnalyticsService';
import { DigestService } from '../services/DigestService';
import { buildTrackingPixelUrl } from '../routes/track';

function formatWeekLabel(weekStart: Date, weekEnd: Date): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  const start = weekStart.toLocaleDateString('en-GB', opts);
  // weekEnd is exclusive (the Monday just gone), so show the Sunday before it.
  const lastDay = new Date(weekEnd.getTime() - 86_400_000);
  const end = lastDay.toLocaleDateString('en-GB', opts);
  return `${start} – ${end}`;
}

/**
 * Build and send the digest for every family with something to report.
 *
 * Exported so it can be exercised directly in tests and triggered manually on day one, rather than
 * waiting a week to find out whether it works.
 */
export async function sendWeeklyDigests(now: Date = new Date()): Promise<{
  families: number;
  sent: number;
  skippedSilent: number;
}> {
  const families = await prisma.family.findMany({
    where: { deletedAt: null },
    select: { id: true },
  });

  let sent = 0;
  let skippedSilent = 0;

  for (const family of families) {
    try {
      const digest = await DigestService.buildFamilyDigest(family.id, now);

      // A silent week sends nothing — a "0 tasks, 0 points" email trains parents to ignore us.
      if (!digest) {
        skippedSilent++;
        continue;
      }

      await EmailService.sendToFamilyParents({
        familyId: family.id,
        triggerType: 'weekly_digest',
        subjectBuilder: () =>
          digest.pendingApprovals > 0
            ? `${digest.pendingApprovals} task${digest.pendingApprovals === 1 ? '' : 's'} waiting — your TaskBuddy week`
            : `${digest.totals.tasksApproved} task${digest.totals.tasksApproved === 1 ? '' : 's'} done — your TaskBuddy week`,
        // Greet each co-parent by their own name rather than sharing one rendering.
        templateDataBuilder: (parent) => ({ parentFirstName: parent.firstName }),
        templateData: {
          parentFirstName: 'there', // fallback if the builder is ever dropped
          weekLabel: formatWeekLabel(digest.weekStart, digest.weekEnd),
          children: digest.children,
          pendingApprovals: digest.pendingApprovals,
          expiringRewards: digest.expiringRewards.map((r) => ({
            name: r.name,
            expiresAt: r.expiresAt.toISOString(),
          })),
          totals: digest.totals,
          suggestedAction: digest.suggestedAction,
          trackingPixelUrl: buildTrackingPixelUrl(family.id, now),
        },
      });

      sent++;

      void AnalyticsService.record({
        eventType: 'DIGEST_SENT',
        familyId: family.id,
        actorRole: 'system',
        payload: {
          tasksApproved: digest.totals.tasksApproved,
          pointsEarned: digest.totals.pointsEarned,
          pendingApprovals: digest.pendingApprovals,
        },
      });
    } catch (err) {
      // Per-family isolation: one bad family must not abort the whole Monday run.
      console.error(
        `[digestCron] Failed to send digest for family ${family.id}:`,
        (err as Error)?.message,
      );
    }
  }

  return { families: families.length, sent, skippedSilent };
}

// ─── Cron entry point ─────────────────────────────────────────────────────────

export function startDigestCron(): void {
  // 07:00 UTC every Monday.
  cron.schedule('0 7 * * 1', async () => {
    console.log('[digestCron] Starting weekly digest run...');
    try {
      const result = await sendWeeklyDigests();
      console.log(
        `[digestCron] Complete — ${result.sent} sent, ${result.skippedSilent} skipped (no activity), of ${result.families} families.`,
      );
    } catch (err) {
      console.error('[digestCron] Unhandled error during run:', (err as Error)?.message);
    }
  });

  console.log('[digestCron] Scheduled: Mondays at 07:00 UTC');
}
