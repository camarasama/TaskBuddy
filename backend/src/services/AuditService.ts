/**
 * services/AuditService.ts — M8
 *
 * Provides a single logAction() helper that writes an immutable row to the
 * audit_logs table. Every mutating route in the app calls this after a
 * successful DB operation so the admin can see a full history of what
 * changed, who changed it, and when.
 *
 * Design decisions:
 *  - logAction() is fire-and-forget from the caller's perspective: it never
 *    throws. If the write fails (e.g. DB overload) we log to stderr and
 *    continue rather than failing the original request. Audit loss is
 *    preferable to user-visible errors.
 *  - The metadata field accepts any JSON — callers include a before/after
 *    snapshot for updates, or a small context object for creates/deletes.
 *  - actorId is nullable to support system/cron-generated events (e.g. the
 *    recurring task scheduler) where there is no human actor.
 *  - familyId is nullable for cross-family admin actions.
 */

import { prisma } from './database';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditLogInput {
  /** The user who performed the action. Null for system/cron events. */
  actorId: string | null | undefined;

  /**
   * A short uppercase verb describing the action.
   * Recommended values (not enforced — use consistently):
   *   CREATE | UPDATE | DELETE | APPROVE | REJECT | REDEEM | FULFILL |
   *   CANCEL | SUSPEND | REACTIVATE | LOGIN | REGISTER | INVITE_SENT |
   *   INVITE_ACCEPTED | FORCE_RESET | COMPLETE | SELF_ASSIGN
   */
  action: string;

  /**
   * The type of resource that was affected.
   * Recommended values:
   *   task | task_assignment | reward | reward_redemption |
   *   family | user | child | invitation | achievement
   */
  resourceType: string;

  /** The primary key of the affected record. */
  resourceId: string;

  /** Family scope — null for cross-family or admin-only actions. */
  familyId?: string | null;

  /**
   * Optional JSON context. Good patterns:
   *   - Create:  { title, taskTag } — enough to identify the record
   *   - Update:  { changes: req.body } — the incoming patch
   *   - Approve: { pointsAwarded, xpAwarded, levelUp }
   *   - Delete:  { name, reason }
   */
  metadata?: Record<string, unknown> | null;

  /** IPv4/IPv6 address of the HTTP client, from req.ip. */
  ipAddress?: string | null;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const AuditService = {
  /**
   * Write one immutable audit log entry.
   *
   * This function is intentionally non-throwing: any DB error is swallowed
   * and written to stderr so the calling route is not disrupted.
   *
   * Usage:
   *   await AuditService.logAction({
   *     actorId: req.user!.userId,
   *     action: 'CREATE',
   *     resourceType: 'task',
   *     resourceId: task.id,
   *     familyId: req.familyId,
   *     ipAddress: req.ip,
   *     metadata: { title: task.title, taskTag: task.taskTag },
   *   });
   */
  async logAction(input: AuditLogInput): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          actorId:      input.actorId ?? null,
          action:       input.action,
          resourceType: input.resourceType,
          resourceId:   input.resourceId,
          familyId:     input.familyId ?? null,
          metadata:     input.metadata ?? undefined,
          ipAddress:    input.ipAddress ?? null,
        },
      });
    } catch (err) {
      // Audit failure must never break the originating request.
      // Log to stderr so infrastructure alerts can still fire.
      console.error('[AuditService] Failed to write audit log:', {
        action:       input.action,
        resourceType: input.resourceType,
        resourceId:   input.resourceId,
        error:        err,
      });
    }
  },

  /**
   * Convenience wrapper for system/cron events where there is no human actor.
   *
   * Usage:
   *   await AuditService.logSystem({
   *     action: 'CREATE',
   *     resourceType: 'task_assignment',
   *     resourceId: assignment.id,
   *     metadata: { reason: 'recurring_scheduler', taskId },
   *   });
   */
  async logSystem(input: Omit<AuditLogInput, 'actorId' | 'ipAddress'>): Promise<void> {
    return AuditService.logAction({
      ...input,
      actorId: null,
      ipAddress: null,
    });
  },
};
