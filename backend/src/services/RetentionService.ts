/**
 * RetentionService - GDPR-K data retention / hard-delete (Phase 7).
 *
 * A soft-deleted family (deletedAt set) is kept for `config.retention.days` (default 30) so the
 * owner can recover it, then hard-deleted here. Deleting the Family row cascades to its users,
 * children, tasks, assignments, evidence rows, etc. Before that we:
 *   - delete the evidence objects from R2 (the sensitive child photos), and
 *   - REDACT (not delete) audit + email logs for the family, keeping the event skeleton for
 *     security/forensics while dropping PII.
 *
 * SAFETY: gated behind `config.retention.purgeEnabled` (env RETENTION_PURGE_ENABLED). While off,
 * runRetention only logs what it *would* purge and deletes nothing.
 */

import { prisma } from './database';
import { config } from '../config';
import { deleteFile } from './storage';

export interface RetentionResult {
  enabled: boolean;
  families: number; // how many were past the retention window
  purged: number;   // how many were actually hard-deleted (0 when disabled)
  /** Analytics events deleted by the age-based sweep (0 when disabled). */
  analyticsPurged: number;
}

function cutoff(now: Date): Date {
  return new Date(now.getTime() - config.retention.days * 86_400_000);
}

async function findExpiredFamilies(now: Date): Promise<{ id: string }[]> {
  return prisma.family.findMany({
    where: { deletedAt: { not: null, lt: cutoff(now) } },
    select: { id: true },
  });
}

/** Delete evidence objects from R2, redact logs, then hard-delete the family (cascade). */
async function purgeFamily(familyId: string): Promise<void> {
  // 1. Remove the private evidence objects from R2 before their rows vanish.
  const evidence = await prisma.taskEvidence.findMany({
    where: { fileKey: { not: null }, assignment: { task: { familyId } } },
    select: { fileKey: true, thumbnailKey: true },
  });
  for (const e of evidence) {
    if (e.fileKey) {
      await deleteFile(e.fileKey, e.thumbnailKey ?? '', { kind: 'evidence' }).catch(() => {});
    }
  }

  // 2. Redact logs — keep the event skeleton, drop PII (never delete audit history).
  await prisma.auditLog.updateMany({
    where: { familyId },
    data: { metadata: { redacted: true } },
  });
  await prisma.emailLog.updateMany({
    where: { familyId },
    data: { toEmail: '[redacted]' },
  });

  // 3. Hard-delete the family — cascades to users/children/tasks/assignments/evidence.
  await prisma.family.delete({ where: { id: familyId } });
}

/**
 * Purge analytics events past the retention window.
 *
 * `analytics_events` has no FK to families precisely so the family purge cannot cascade into it and
 * erase funnel history — which means it needs its own age-based sweep, or the table would grow
 * forever and PRIVACY.md's retention claim would be false for it. Runs on the same
 * RETENTION_DAYS window and honours the same dry-run gate as the family purge.
 */
async function purgeAnalyticsEvents(now: Date): Promise<number> {
  const cutoffDate = cutoff(now);

  if (!config.retention.purgeEnabled) {
    const wouldDelete = await prisma.analyticsEvent.count({
      where: { createdAt: { lt: cutoffDate } },
    });
    if (wouldDelete > 0) {
      console.log(
        `[Retention] DRY RUN - ${wouldDelete} analytics event(s) older than ` +
          `${config.retention.days} days would be deleted.`,
      );
    }
    return 0;
  }

  const { count } = await prisma.analyticsEvent.deleteMany({
    where: { createdAt: { lt: cutoffDate } },
  });
  if (count > 0) console.log(`[Retention] Deleted ${count} expired analytics event(s).`);
  return count;
}

export const RetentionService = {
  findExpiredFamilies,
  purgeAnalyticsEvents,

  /**
   * Purge families past the retention window. No-op (log only) unless RETENTION_PURGE_ENABLED=true.
   */
  async runRetention(now: Date = new Date()): Promise<RetentionResult> {
    // Independent of the family sweep — analytics rows outlive their family by design, so this runs
    // whether or not any family is due for purging. Failure here must not skip the family purge.
    const analyticsPurged = await purgeAnalyticsEvents(now).catch((err) => {
      console.error('[Retention] Analytics purge failed:', (err as Error)?.message);
      return 0;
    });

    const families = await findExpiredFamilies(now);

    if (families.length === 0) {
      return {
        enabled: config.retention.purgeEnabled,
        families: 0,
        purged: 0,
        analyticsPurged,
      };
    }

    if (!config.retention.purgeEnabled) {
      console.log(
        `[Retention] DRY RUN - ${families.length} family(ies) past the ${config.retention.days}-day ` +
          'soft-delete window would be hard-deleted. Set RETENTION_PURGE_ENABLED=true to enable.',
      );
      return { enabled: false, families: families.length, purged: 0, analyticsPurged };
    }

    let purged = 0;
    for (const fam of families) {
      try {
        await purgeFamily(fam.id);
        purged++;
      } catch (err) {
        console.error(`[Retention] Failed to purge family ${fam.id}:`, (err as Error)?.message);
      }
    }
    console.log(`[Retention] Purged ${purged}/${families.length} expired family(ies).`);
    return { enabled: true, families: families.length, purged, analyticsPurged };
  },
};
