/**
 * services/TransitionService.ts — what happens when a child turns 18.
 *
 * ## The shape of the decision, and who makes it
 *
 * At `AGE_LIMITS.ADULT_MIN` a child account is flagged and the **parent** decides. The young adult
 * is not emailed: children have no email address in TaskBuddy and never have, and collecting one at
 * exactly the moment they stop being a child would mean gathering a new piece of personal data to
 * ask a question the parent can answer instead.
 *
 * The account keeps working while the decision is pending. Freezing it would punish the young person
 * for a parent's inaction, and the thing being decided is the points, not their access.
 *
 * ## ⚠️ The compliance point this design leaves open
 *
 * At 18 the person is an adult and the parental consent that legitimised processing their data
 * lapses. The parent deciding the fate of the POINTS is defensible — points are the family's
 * economy, not personal data. The personal data becomes the young adult's own, and a complete
 * implementation would notify them and offer export or deletion in their own right, independent of
 * what the parent chooses. That is recorded as owed rather than quietly skipped.
 *
 * ## Why the deadline exists
 *
 * Without one, an ignored email leaves an adult sitting in a child account indefinitely. With one,
 * inaction has a defined result rather than an accidental one.
 */
import { AGE_LIMITS, isAgeBetween } from '@taskbuddy/shared';

import { prisma } from './database';
import { AuditService } from './AuditService';
import { ConflictError, NotFoundError, ValidationError } from '../middleware/errorHandler';

/** Days a parent has before the default applies. Agreed 2026-08-11. */
export const TRANSITION_DEADLINE_DAYS = 30;

export type TransitionDecision = 'transfer' | 'discard' | 'invite';

/**
 * Everyone who has turned 18 and has no transition row yet.
 *
 * Deliberately re-derived from `dateOfBirth` rather than trusted from a flag: a flag is only as
 * current as the last job run, and the birth date cannot go stale.
 */
export async function findNewlyAged(now: Date = new Date()) {
  const candidates = await prisma.user.findMany({
    where: {
      role: 'child',
      deletedAt: null,
      dateOfBirth: { not: null },
      transition: null,
    },
    select: {
      id: true,
      familyId: true,
      firstName: true,
      dateOfBirth: true,
      childProfile: { select: { pointsBalance: true } },
    },
  });

  // `isAgeBetween(dob, 18, null)` is the same helper every validator uses, so "18" means the same
  // thing here as it does on the registration form. A local age calculation is how the two drift.
  return candidates.filter((c) => c.dateOfBirth && isAgeBetween(c.dateOfBirth, AGE_LIMITS.ADULT_MIN, null, now));
}

/** Open a pending transition. Idempotent: the unique index on childId makes a double-run a no-op. */
export async function openTransition(
  child: { id: string; familyId: string | null; childProfile?: { pointsBalance: number } | null },
  now: Date = new Date(),
) {
  if (!child.familyId) return null;

  const deadlineAt = new Date(now);
  deadlineAt.setDate(deadlineAt.getDate() + TRANSITION_DEADLINE_DAYS);

  return prisma.accountTransition.create({
    data: {
      familyId: child.familyId,
      childId: child.id,
      // Snapshotted so the record still reads correctly after the balance moves. Reading the live
      // balance later would show 0 for every resolved transfer and make the history meaningless.
      pointsAtDetection: child.childProfile?.pointsBalance ?? 0,
      deadlineAt,
    },
  });
}

/**
 * Apply a parent's decision.
 *
 * `transfer` moves the whole balance to one sibling. Partial splits were considered and left out:
 * they multiply the UI and the arithmetic for a case that arises once per child, and "all of it to
 * one person" is what a parent actually says out loud.
 */
export async function resolveTransition(input: {
  transitionId: string;
  familyId: string;
  actorId: string;
  decision: TransitionDecision;
  transferToChildId?: string;
  ipAddress?: string;
}) {
  const { transitionId, familyId, actorId, decision, transferToChildId, ipAddress } = input;

  const transition = await prisma.accountTransition.findFirst({
    where: { id: transitionId, familyId },
  });
  if (!transition) throw new NotFoundError('Transition not found');
  if (transition.status !== 'pending') {
    // A co-parent may have resolved it a moment earlier. That is a real answer, not a fault.
    throw new ConflictError('This has already been decided.');
  }

  if (decision === 'transfer') {
    if (!transferToChildId) throw new ValidationError('Choose which sibling receives the points');

    // Scoped to the same family AND to role child: without both, a transfer id could be edited to
    // move points to another family's child, or to an adult who has no points balance at all.
    const recipient = await prisma.user.findFirst({
      where: { id: transferToChildId, familyId, role: 'child', deletedAt: null },
      select: { id: true },
    });
    if (!recipient) throw new ValidationError('That sibling is not part of this family');
    if (recipient.id === transition.childId) {
      throw new ValidationError('Points cannot be transferred to the same person');
    }
  }

  return prisma.$transaction(async (tx) => {
    const profile = await tx.childProfile.findUnique({
      where: { userId: transition.childId },
      select: { pointsBalance: true },
    });
    const balance = profile?.pointsBalance ?? 0;

    if (decision === 'transfer' && transferToChildId && balance > 0) {
      await tx.childProfile.update({
        where: { userId: transferToChildId },
        data: { pointsBalance: { increment: balance } },
      });
    }

    // Zeroed for transfer AND discard: in both cases the points leave this account. Leaving them
    // behind on a discard would mean "discarded" points still spendable.
    if (balance > 0) {
      await tx.childProfile.update({
        where: { userId: transition.childId },
        data: { pointsBalance: 0 },
      });
    }

    const updated = await tx.accountTransition.update({
      where: { id: transition.id },
      data: {
        status: 'resolved',
        decision,
        transferToChildId: decision === 'transfer' ? transferToChildId : null,
        resolvedAt: new Date(),
      },
    });

    await AuditService.logAction({
      actorId,
      action: 'UPDATE',
      resourceType: 'account_transition',
      resourceId: transition.id,
      familyId,
      ipAddress,
      metadata: { decision, transferToChildId: transferToChildId ?? null, points: balance },
    });

    return updated;
  });
}

/**
 * Apply the default to everything past its deadline.
 *
 * The agreed default is discard. It is the conservative one: transferring by default would move a
 * young adult's points to a sibling without anyone having asked for that, and an unasked-for
 * transfer is much harder to explain afterwards than points that simply stopped existing.
 */
export async function expireOverdue(now: Date = new Date()) {
  const overdue = await prisma.accountTransition.findMany({
    where: { status: 'pending', deadlineAt: { lt: now } },
    select: { id: true, childId: true, familyId: true },
  });

  const results = [];
  for (const row of overdue) {
    // Per-row isolation: one family's bad data must not abort the whole sweep.
    try {
      await prisma.$transaction(async (tx) => {
        await tx.childProfile.updateMany({ where: { userId: row.childId }, data: { pointsBalance: 0 } });
        await tx.accountTransition.update({
          where: { id: row.id },
          data: { status: 'expired', decision: 'discard', resolvedAt: now },
        });
      });
      await AuditService.logSystem({
        action: 'UPDATE',
        resourceType: 'account_transition',
        resourceId: row.id,
        familyId: row.familyId,
        metadata: { decision: 'discard', reason: 'deadline_expired' },
      });
      results.push(row.id);
    } catch (err) {
      console.error('[TransitionService] expiry failed for', row.id, (err as Error)?.message);
    }
  }
  return results;
}

export const TransitionService = {
  TRANSITION_DEADLINE_DAYS,
  findNewlyAged,
  openTransition,
  resolveTransition,
  expireOverdue,
};
