/**
 * services/NotificationPolicy.ts — the global email frequency cap (growth roadmap §8).
 *
 * The roadmap said to adopt this **before** shipping the new triggers. It was not, and the run has
 * since added the weekly digest, parent-push-on-submit and the consent emails on top of an existing
 * thirteen. Unsubscribes are unrecoverable, so this is overdue rather than premature.
 *
 * **The classification is the whole design.** Getting it wrong in either direction is bad in a
 * different way: cap something transactional and a parent cannot reset their password; leave
 * everything uncapped and a busy family gets six emails on a Tuesday and mutes the sender forever.
 *
 * One deliberate consequence worth understanding: `task_submitted` IS capped. A child submitting five
 * tasks in an evening should not produce five emails. The parent still gets a **push per submission**
 * (uncapped, added in #71) and the approval queue on the dashboard — so the fast channel stays fully
 * open and only the slow one is rationed.
 */

import { prisma } from './database';
import type { EmailTriggerType } from './email';

/**
 * Never capped. Each of these is either account access, a legal obligation, a security notice, or a
 * once-per-lifetime message that cannot be re-sent later.
 */
export const TRANSACTIONAL: ReadonlySet<string> = new Set<EmailTriggerType>([
  'email_verification',   // without it the account cannot be used
  'password_reset',       // without it the account cannot be recovered
  'parental_consent',     // COPPA — legally required, and blocks child creation
  'co_parent_invite',     // someone is actively waiting on it
  'admin_created',        // account access
  'child_locked',         // security notice
  'welcome',              // one-off at signup
  'child_welcome',        // one-off at child creation
]);

/**
 * Exempt from the cap but not transactional: the digest is the deliberate weekly touch, and capping
 * it would sometimes silence the one message specifically designed to be the week's only email.
 */
export const CAP_EXEMPT: ReadonlySet<string> = new Set<EmailTriggerType>(['weekly_digest']);

/** Everything else is lifecycle and rationed. */
export const DAILY_LIMIT = 1;
export const WEEKLY_LIMIT = 3;

export interface CapDecision {
  allowed: boolean;
  /** Present when blocked; logged, never shown to a user. */
  reason?: string;
}

export function isCapped(triggerType: string): boolean {
  return !TRANSACTIONAL.has(triggerType) && !CAP_EXEMPT.has(triggerType);
}

/**
 * May we send this lifecycle email to this user right now?
 *
 * **Fails OPEN.** If the check itself errors, the email goes out. A throttle that silently swallowed
 * mail because a count query failed would be a worse bug than the fatigue it prevents, and it would
 * be invisible.
 *
 * A null `toUserId` (pre-registration invitee) is never capped — there is no history to count, and
 * those sends are transactional anyway.
 */
export async function checkCap(params: {
  triggerType: string;
  toUserId: string | null;
  now?: Date;
}): Promise<CapDecision> {
  const { triggerType, toUserId } = params;

  if (!isCapped(triggerType)) return { allowed: true };
  if (!toUserId) return { allowed: true };

  const now = params.now ?? new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    // Only successful sends count. A bounce or an SMTP failure did not reach anyone, so counting it
    // would silence the retry as well as the original.
    const recent = await prisma.emailLog.findMany({
      where: { toUserId, createdAt: { gte: weekAgo }, status: 'sent' },
      select: { triggerType: true, createdAt: true },
    });

    const lifecycle = recent.filter((r) => isCapped(r.triggerType));
    const today = lifecycle.filter((r) => r.createdAt >= dayAgo).length;

    if (today >= DAILY_LIMIT) {
      return { allowed: false, reason: `daily cap (${today}/${DAILY_LIMIT})` };
    }
    if (lifecycle.length >= WEEKLY_LIMIT) {
      return { allowed: false, reason: `weekly cap (${lifecycle.length}/${WEEKLY_LIMIT})` };
    }

    return { allowed: true };
  } catch (error) {
    console.warn(
      `[NotificationPolicy] cap check failed for ${triggerType}; allowing:`,
      (error as Error)?.message,
    );
    return { allowed: true };
  }
}

export const NotificationPolicy = {
  checkCap,
  isCapped,
  TRANSACTIONAL,
  CAP_EXEMPT,
  DAILY_LIMIT,
  WEEKLY_LIMIT,
};
