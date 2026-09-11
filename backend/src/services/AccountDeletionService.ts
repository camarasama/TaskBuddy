/**
 * Self-service account deletion: the parent-facing half of the retention pipeline.
 *
 * `RetentionService` has always been able to hard-delete a family, erase its evidence photos from
 * R2 and redact its logs. Nothing in the product ever set `family.deletedAt`, so it only ever ran
 * over an empty set and the only real route to deletion was emailing privacy@. Google Play expects
 * an account holder to be able to start deletion from inside the app. This is that entry point.
 *
 * ## What this does, and deliberately does not do
 *
 * It SCHEDULES. It sets `family.deletedAt` and returns the date the data actually goes. The
 * destruction itself stays where it already lives, in `RetentionService.runRetention`, because that
 * code already handles the parts that are easy to get wrong: deleting the private evidence objects
 * before their rows vanish, and redacting the audit and email logs rather than deleting them.
 * Splitting the trigger from the mechanism also means the recovery window is real rather than a
 * promise, and that a bug here cannot destroy anything.
 *
 * ⚠️ **The purge is gated by `RETENTION_PURGE_ENABLED`, which defaults to false.** With it off, the
 * retention job logs what it would delete and deletes nothing, so a family scheduled here would sit
 * soft-deleted forever and the 30-day promise in ACCOUNT_DELETION.md would be false. Turning it on
 * in production is a deployment step, not a code change. See docs/DEPLOYMENT.md.
 *
 * ## Why the primary parent only
 *
 * This erases other people's data: a co-parent's account and every child's history. Removing a
 * co-parent is already primary-parent-only (`inviteService.removeParent`), and deleting the whole
 * family is strictly the larger act. A co-parent who wants out can be removed, or remove themselves,
 * without taking the children's records with them.
 *
 * ## Why the password is re-checked
 *
 * A logged-in session on an unlocked phone is not proof that the account holder is the one tapping.
 * Every other destructive action here is reversible or small; this one is neither, so it re-proves
 * possession of the password immediately before scheduling. The same reasoning as the typed
 * confirmation in the UI, but server-side, where it cannot be skipped by calling the API directly.
 */

import bcrypt from 'bcrypt';

import { prisma } from './database';
import { config } from '../config';
import { AuditService } from './AuditService';
import { EmailService } from './email';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../middleware/errorHandler';

export interface DeletionStatus {
  /** True while `family.deletedAt` is set, i.e. inside the recovery window. */
  scheduled: boolean;
  /** When the parent asked. Null when nothing is scheduled. */
  requestedAt: string | null;
  /** When the data is actually destroyed. Null when nothing is scheduled. */
  purgeAfter: string | null;
  /** Days between the request and the purge, so the client need not know the server's config. */
  graceDays: number;
}

interface ActorContext {
  userId: string;
  familyId: string;
  ipAddress?: string;
}

function purgeDate(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + config.retention.days * 86_400_000);
}

function statusFrom(deletedAt: Date | null): DeletionStatus {
  if (!deletedAt) {
    return {
      scheduled: false,
      requestedAt: null,
      purgeAfter: null,
      graceDays: config.retention.days,
    };
  }
  return {
    scheduled: true,
    requestedAt: deletedAt.toISOString(),
    purgeAfter: purgeDate(deletedAt).toISOString(),
    graceDays: config.retention.days,
  };
}

/**
 * Load the acting parent and prove they may do this.
 *
 * Throws rather than returning a flag: every caller here treats a failed check as fatal, and a
 * boolean would make it possible to forget to test it.
 */
async function requirePrimaryParent(actor: ActorContext) {
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: {
      id: true,
      familyId: true,
      role: true,
      isPrimaryParent: true,
      passwordHash: true,
      firstName: true,
    },
  });

  if (!user || user.familyId !== actor.familyId) {
    throw new NotFoundError('Account not found');
  }
  if (user.role !== 'parent' || !user.isPrimaryParent) {
    throw new ForbiddenError(
      'Only the primary parent can delete the family account. Ask them to do it, or remove yourself as a co-parent instead.',
    );
  }
  return user;
}

export const AccountDeletionService = {
  /** What the banner and the settings screen render from. Safe for any parent in the family. */
  async getStatus(familyId: string): Promise<DeletionStatus> {
    const family = await prisma.family.findUnique({
      where: { id: familyId },
      select: { deletedAt: true },
    });
    if (!family) throw new NotFoundError('Family not found');
    return statusFrom(family.deletedAt);
  },

  /**
   * Schedule the family for deletion after the retention window.
   *
   * Idempotent by design: asking twice does NOT move the date. Re-requesting returns the existing
   * schedule unchanged, so a double tap, a retried request or a second parent cannot quietly push
   * the purge further out and turn "30 days" into an open-ended lease.
   */
  async schedule(actor: ActorContext, password: string): Promise<DeletionStatus> {
    const user = await requirePrimaryParent(actor);

    // A parent account always has a password hash; treat its absence as a failed check rather than
    // letting bcrypt.compare(…, null) throw somewhere less obvious.
    const valid = user.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!valid) {
      throw new UnauthorizedError('That password is not correct.');
    }

    const family = await prisma.family.findUnique({
      where: { id: actor.familyId },
      select: { deletedAt: true, familyName: true },
    });
    if (!family) throw new NotFoundError('Family not found');

    if (family.deletedAt) {
      return statusFrom(family.deletedAt);
    }

    const requestedAt = new Date();
    await prisma.family.update({
      where: { id: actor.familyId },
      data: { deletedAt: requestedAt },
    });

    await AuditService.logAction({
      actorId: actor.userId,
      action: 'DELETE',
      resourceType: 'family',
      resourceId: actor.familyId,
      familyId: actor.familyId,
      ipAddress: actor.ipAddress,
      metadata: {
        event: 'account_deletion_scheduled',
        purgeAfter: purgeDate(requestedAt).toISOString(),
      },
    });

    // Every parent is told, not just the one who asked. A co-parent finding out when the app stops
    // working is how this feature becomes a support incident; it is also their family's data.
    // Fire-and-forget: a mail failure must not leave the schedule half-applied.
    void EmailService.sendToFamilyParents({
      familyId: actor.familyId,
      triggerType: 'account_deletion_scheduled',
      subjectBuilder: () => 'Your TaskBuddy account is scheduled for deletion',
      templateData: {
        familyName: family.familyName,
        requestedByName: user.firstName,
        purgeDate: purgeDate(requestedAt).toISOString(),
        graceDays: config.retention.days,
      },
      // Greets each co-parent by their own name; the rest of the notice is shared.
      templateDataBuilder: (parent) => ({ parentFirstName: parent.firstName }),
    }).catch((err) => {
      console.error('[AccountDeletion] schedule notice failed:', (err as Error)?.message);
    });

    return statusFrom(requestedAt);
  },

  /**
   * Cancel a pending deletion and restore normal service.
   *
   * Clearing `deletedAt` is genuinely all that is needed while the window is open, because nothing
   * has been destroyed yet: the purge is the only thing that removes data, and it has not run. Once
   * it has, the family row is gone and this endpoint 404s, which is the correct and honest answer.
   */
  async cancel(actor: ActorContext): Promise<DeletionStatus> {
    const user = await requirePrimaryParent(actor);

    const family = await prisma.family.findUnique({
      where: { id: actor.familyId },
      select: { deletedAt: true, familyName: true },
    });
    if (!family) throw new NotFoundError('Family not found');

    if (!family.deletedAt) {
      return statusFrom(null);
    }

    await prisma.family.update({
      where: { id: actor.familyId },
      data: { deletedAt: null },
    });

    await AuditService.logAction({
      actorId: actor.userId,
      action: 'UPDATE',
      resourceType: 'family',
      resourceId: actor.familyId,
      familyId: actor.familyId,
      ipAddress: actor.ipAddress,
      metadata: { event: 'account_deletion_cancelled' },
    });

    void EmailService.sendToFamilyParents({
      familyId: actor.familyId,
      triggerType: 'account_deletion_cancelled',
      subjectBuilder: () => 'Your TaskBuddy account will not be deleted',
      templateData: {
        familyName: family.familyName,
        cancelledByName: user.firstName,
      },
      templateDataBuilder: (parent) => ({ parentFirstName: parent.firstName }),
    }).catch((err) => {
      console.error('[AccountDeletion] cancel notice failed:', (err as Error)?.message);
    });

    return statusFrom(null);
  },
};
