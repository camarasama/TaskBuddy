import { prisma } from './database';
import { GAMIFICATION_M7 } from '../utils/gamification';
import { checkAndApplyLevelUp } from './levelService';
import { checkAndUnlockAchievements } from './achievements';
import { evaluateStreak } from './streakService';
import { AuditService } from './AuditService';
import { EmailService } from './email';
import { SocketService } from './SocketService';
import { AnalyticsService } from './AnalyticsService';
import { awardTeamBonusIfComplete } from './TeamTaskService';
import { createNotification } from '../routes/notifications';
import { checkAssignmentLimits } from '../utils/assignmentLimits';
import { getTaskOverlaps } from '../utils/overlapCheck';
import { NotFoundError, ForbiddenError, ConflictError } from '../middleware/errorHandler';
import { resolveClientTimestamp } from '../utils/clientTimestamp';

interface CreateTaskParams {
  familyId: string;
  createdBy: string;
  taskTag: 'primary' | 'secondary';
  assignedTo: string[];
  dueDate?: string;
  startTime?: string;
  estimatedMinutes?: number;
  taskData: Record<string, unknown>;
  ipAddress?: string;
}

interface SubmitCompletionParams {
  assignmentId: string;
  familyId: string;
  userId: string;
  userRole: string;
  note?: string;
  /**
   * FR-13: ISO instant captured on the device when the child tapped Complete. Present only for a
   * replayed offline action; absent means "right now" and behaves exactly as before.
   */
  completedAt?: string;
  ipAddress?: string;
}

interface ApproveAssignmentParams {
  assignmentId: string;
  familyId: string;
  parentId: string;
  approved: boolean;
  rejectionReason?: string;
  ipAddress?: string;
}

/**
 * Push every active parent in the family a "needs your approval" notification that deep-links to the
 * one-tap approval screen.
 *
 * Fire-and-forget and individually guarded: one parent's push failing must not stop the others, and
 * none of it may fail the child's submission.
 */
async function notifyParentsOfSubmission(params: {
  familyId: string;
  excludeUserId: string;
  assignmentId: string;
  childName: string;
  taskTitle: string;
}): Promise<void> {
  try {
    const parents = await prisma.user.findMany({
      where: {
        familyId: params.familyId,
        role: 'parent',
        deletedAt: null,
        isActive: true,
        id: { not: params.excludeUserId },
      },
      select: { id: true },
    });

    await Promise.all(
      parents.map((parent) =>
        createNotification({
          userId: parent.id,
          notificationType: 'task_submitted',
          title: `${params.childName} finished a task`,
          message: `"${params.taskTitle}" is waiting for your approval.`,
          actionUrl: `/parent/approve/${params.assignmentId}`,
          referenceType: 'task_assignment',
          referenceId: params.assignmentId,
        }).catch(() => {}),
      ),
    );
  } catch (err) {
    console.error('[TaskService] parent submission notification failed:', (err as Error)?.message);
  }
}

export class TaskService {
  static async createTask(params: CreateTaskParams) {
    const { familyId, createdBy, taskTag, assignedTo, dueDate, startTime, estimatedMinutes, taskData, ipAddress } = params;

    if (assignedTo.length > 0) {
      const children = await prisma.user.findMany({
        where: { id: { in: assignedTo }, familyId, role: 'child', deletedAt: null },
      });

      if (children.length !== assignedTo.length) {
        throw new NotFoundError('One or more children not found');
      }

      for (const childId of assignedTo) {
        const limitCheck = await checkAssignmentLimits(childId, taskTag);
        if (!limitCheck.allowed) {
          const child = children.find((c) => c.id === childId);
          const name = child ? child.firstName : 'A child';
          throw new ConflictError(`${name}: ${limitCheck.reason}`);
        }
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parsedStartTime = startTime ? new Date(startTime) : null;
    const allWarnings: Awaited<ReturnType<typeof getTaskOverlaps>> = [];

    if (assignedTo.length > 0) {
      for (const childId of assignedTo) {
        const overlaps = await getTaskOverlaps(childId, parsedStartTime, estimatedMinutes ?? null, today);
        allWarnings.push(...overlaps);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          ...(taskData as any),
          taskTag,
          familyId,
          createdBy,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          startTime: parsedStartTime ?? undefined,
          estimatedMinutes: estimatedMinutes ?? undefined,
        },
      });

      const assignments = assignedTo.length > 0
        ? await Promise.all(
            assignedTo.map((childId: string) =>
              tx.taskAssignment.create({
                data: { taskId: task.id, childId, instanceDate: today },
                include: { child: { select: { id: true, firstName: true, lastName: true } } },
              })
            )
          )
        : [];

      return { task, assignments };
    });

    await AuditService.logAction({
      actorId: createdBy,
      action: 'CREATE',
      resourceType: 'task',
      resourceId: result.task.id,
      familyId,
      ipAddress,
      metadata: {
        title: result.task.title,
        taskTag: result.task.taskTag,
        assignedTo,
        isRecurring: result.task.isRecurring,
      },
    });

    for (const assignment of result.assignments) {
      createNotification({
        userId: assignment.childId,
        notificationType: 'task_assigned',
        title: '📋 New Task Assigned',
        message: `You have a new task: "${result.task.title}". Earn ${result.task.pointsValue} pts when approved!`,
        actionUrl: '/child/tasks',
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      }).catch(() => {});
    }

    return { ...result, warnings: allWarnings };
  }

  static async submitCompletion(params: SubmitCompletionParams) {
    const { assignmentId, familyId, userId, userRole, note, completedAt, ipAddress } = params;

    // FR-13: resolve the client's clock FIRST — a rejected timestamp must cost nothing and must
    // never half-apply. `completionTime` is the single moment this whole method acts on.
    const completionTime = resolveClientTimestamp(completedAt, { field: 'completedAt' });

    const assignment = await prisma.taskAssignment.findFirst({
      where: { id: assignmentId, task: { familyId, deletedAt: null } },
      include: {
        task: true,
        child: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!assignment) throw new NotFoundError('Assignment not found');

    if (userRole === 'child' && assignment.childId !== userId) {
      throw new ForbiddenError("Cannot complete another child's task");
    }

    if (!['pending', 'in_progress', 'rejected'].includes(assignment.status)) {
      throw new ConflictError('Task is already completed or approved');
    }

    const updated = await prisma.taskAssignment.update({
      where: { id: assignmentId },
      data: { status: 'completed', completedAt: completionTime, rejectionReason: null },
      include: {
        task: true,
        child: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (note) {
      await prisma.taskEvidence.create({
        data: { assignmentId, evidenceType: 'note', note },
      });
    }

    // PD - Time-based auto-approve override: skip auto-approve if completion time is
    // suspiciously short or long relative to estimatedMinutes + family thresholds.
    let timingOverride = false;
    let timingReason: string | undefined;

    if (assignment.task.autoApprove && assignment.task.estimatedMinutes && (assignment as any).startedAt) {
      const settings = await prisma.familySettings.findUnique({
        where: { familyId },
        select: { autoApproveMinRatio: true, autoApproveMaxRatio: true },
      });
      const minRatio = (settings as any)?.autoApproveMinRatio ?? 0.3;
      const maxRatio = (settings as any)?.autoApproveMaxRatio ?? 3.0;
      // FR-13: measure against when the child finished, not when the queue drained — otherwise an
      // overnight sync inflates every offline task past the max ratio and blocks auto-approve.
      const actualMs = completionTime.getTime() - new Date((assignment as any).startedAt).getTime();
      const actualMinutes = Math.max(0, Math.round(actualMs / 60000));
      const est = assignment.task.estimatedMinutes;

      if (actualMinutes < est * minRatio || actualMinutes > est * maxRatio) {
        timingOverride = true;
        timingReason = `Completed in ${actualMinutes}m (est ${est}m)`;
        await prisma.taskAssignment.update({
          where: { id: assignmentId },
          data: { autoApproveOverridden: true, autoApproveOverrideReason: timingReason },
        });
      }
    }

    // BUG-02: Auto-approve path - award XP/points immediately, skip parent queue
    if (assignment.task.autoApprove && !timingOverride) {
      const childWithProfile = await prisma.user.findUnique({
        where: { id: assignment.childId },
        include: { childProfile: true },
      });

      if (childWithProfile?.childProfile) {
        const profile = childWithProfile.childProfile;
        const difficulty = (assignment.task.difficulty ?? 'medium') as keyof typeof GAMIFICATION_M7.TASK_XP;
        const baseXp = GAMIFICATION_M7.TASK_XP[difficulty] ?? GAMIFICATION_M7.TASK_XP.medium;
        const basePoints = assignment.task.pointsValue;
        const newPointsBalance = profile.pointsBalance + basePoints;
        const newXp = profile.experiencePoints + baseXp;
        const newTotalXpEarned = profile.totalXpEarned + baseXp;
        const oldLevel = profile.level;

        const autoApproveResult = await prisma.$transaction(async (tx) => {
          const approvedAssignment = await tx.taskAssignment.update({
            where: { id: assignmentId },
            data: { status: 'approved', approvedAt: new Date(), pointsAwarded: basePoints, xpAwarded: baseXp },
          });

          await tx.childProfile.update({
            where: { userId: assignment.childId },
            data: {
              pointsBalance: newPointsBalance,
              totalPointsEarned: { increment: basePoints },
              totalTasksCompleted: { increment: 1 },
              experiencePoints: newXp,
              totalXpEarned: newTotalXpEarned,
            },
          });

          await tx.pointsLedger.create({
            data: {
              childId: assignment.childId,
              transactionType: 'earned',
              pointsAmount: basePoints,
              balanceAfter: newPointsBalance,
              referenceType: 'task_completion',
              referenceId: assignment.id,
              description: `Auto-approved: ${assignment.task.title}`,
              breakdown: { points: basePoints, xp: baseXp },
            },
          });

          return { assignment: approvedAssignment, pointsAwarded: basePoints, xpAwarded: baseXp, newBalance: newPointsBalance };
        });

        const levelUpResult = await checkAndApplyLevelUp(assignment.childId, oldLevel);
        const unlockedAchievements = await checkAndUnlockAchievements(assignment.childId);
        await evaluateStreak(assignment.childId, familyId, completionTime);

        return { ...autoApproveResult, autoApproved: true as const, levelUp: levelUpResult, unlockedAchievements };
      }
    }

    await AuditService.logAction({
      actorId: userId,
      action: 'COMPLETE',
      resourceType: 'task_assignment',
      resourceId: assignmentId,
      familyId,
      ipAddress,
      metadata: { taskId: assignment.taskId, taskTitle: assignment.task.title },
    });

    EmailService.sendToFamilyParents({
      familyId,
      triggerType: 'task_submitted',
      subjectBuilder: () => `${assignment.child.firstName} completed "${assignment.task.title}"`,
      templateData: {
        childName: assignment.child.firstName,
        taskTitle: assignment.task.title,
        completedAt: completionTime.toISOString(),
        assignmentId: assignment.id,
      },
      referenceType: 'task_assignment',
      referenceId: assignment.id,
    }).catch((err: any) =>
      console.error('[TaskService/submitCompletion] task_submitted email failed:', err?.message)
    );

    createNotification({
      userId,
      notificationType: 'task_submitted',
      title: 'Task Submitted ✓',
      message: `"${assignment.task.title}" is awaiting parent approval.`,
      actionUrl: '/child/tasks',
      referenceType: 'task_assignment',
      referenceId: assignment.id,
    }).catch(() => {});

    // Parents previously got an EMAIL on submit but no push — so the fastest channel was carrying
    // nothing, and approval latency (the loop's heartbeat) suffered for it. Each parent now gets a
    // push that deep-links straight to the one-tap approval screen. createNotification routes to
    // PushService itself, so this needs no separate push call.
    void notifyParentsOfSubmission({
      familyId,
      excludeUserId: userId,
      assignmentId: assignment.id,
      childName: assignment.child.firstName,
      taskTitle: assignment.task.title,
    });

    SocketService.emitTaskSubmitted(familyId, {
      assignmentId,
      taskTitle: assignment.task.title,
      childId: assignment.childId,
    });

    return { assignment: updated };
  }

  static async approveAssignment(params: ApproveAssignmentParams) {
    const { assignmentId, familyId, parentId, approved, rejectionReason, ipAddress } = params;

    const assignment = await prisma.taskAssignment.findFirst({
      where: { id: assignmentId, status: 'completed', task: { familyId, deletedAt: null } },
      include: {
        task: true,
        child: { include: { childProfile: true } },
      },
    });

    if (!assignment) throw new NotFoundError('Completed assignment not found');

    if (approved) {
      const profile = assignment.child.childProfile!;
      const difficulty = (assignment.task.difficulty ?? 'medium') as keyof typeof GAMIFICATION_M7.TASK_XP;
      const baseXp = GAMIFICATION_M7.TASK_XP[difficulty] ?? GAMIFICATION_M7.TASK_XP.medium;
      const basePoints = assignment.task.pointsValue;
      const newPointsBalance = profile.pointsBalance + basePoints;
      const newXp = profile.experiencePoints + baseXp;
      const newTotalXpEarned = profile.totalXpEarned + baseXp;
      const oldLevel = profile.level;

      const result = await prisma.$transaction(async (tx) => {
        const updatedAssignment = await tx.taskAssignment.update({
          where: { id: assignmentId },
          data: { status: 'approved', approvedAt: new Date(), approvedBy: parentId, pointsAwarded: basePoints, xpAwarded: baseXp },
        });

        await tx.childProfile.update({
          where: { userId: assignment.childId },
          data: {
            pointsBalance: newPointsBalance,
            totalPointsEarned: { increment: basePoints },
            totalTasksCompleted: { increment: 1 },
            experiencePoints: newXp,
            totalXpEarned: newTotalXpEarned,
          },
        });

        await tx.pointsLedger.create({
          data: {
            childId: assignment.childId,
            transactionType: 'earned',
            pointsAmount: basePoints,
            balanceAfter: newPointsBalance,
            referenceType: 'task_completion',
            referenceId: assignment.id,
            description: `Completed: ${assignment.task.title}`,
            createdBy: parentId,
            breakdown: { points: basePoints, xp: baseXp },
          },
        });

        return { assignment: updatedAssignment, pointsAwarded: basePoints, xpAwarded: baseXp, newBalance: newPointsBalance };
      });

      const levelUpResult = await checkAndApplyLevelUp(assignment.childId, oldLevel);
      const unlockedAchievements = await checkAndUnlockAchievements(assignment.childId);
      await evaluateStreak(assignment.childId, familyId);

      await AuditService.logAction({
        actorId: parentId,
        action: 'APPROVE',
        resourceType: 'task_assignment',
        resourceId: assignmentId,
        familyId,
        ipAddress,
        metadata: {
          childId: assignment.childId,
          taskId: assignment.taskId,
          pointsAwarded: result.pointsAwarded,
          xpAwarded: result.xpAwarded,
          levelUp: !!levelUpResult?.leveledUp,
        },
      });

      EmailService.sendToFamilyParents({
        familyId,
        triggerType: 'task_approved',
        subjectBuilder: () => `"${assignment.task.title}" approved for ${assignment.child.firstName}`,
        templateData: {
          childName: assignment.child.firstName,
          taskTitle: assignment.task.title,
          pointsAwarded: result.pointsAwarded,
          xpAwarded: result.xpAwarded,
          newBalance: result.newBalance,
        },
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      }).catch((err: any) =>
        console.error('[TaskService/approveAssignment] task_approved email failed:', err?.message)
      );

      createNotification({
        userId: assignment.childId,
        notificationType: 'task_approved',
        title: '🎉 Task Approved!',
        message: `"${assignment.task.title}" approved! You earned +${result.pointsAwarded} pts and +${result.xpAwarded} XP.`,
        actionUrl: '/child/tasks',
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      }).catch(() => {});

      // U17 — if this approval completed a team task, every member gets the teamwork bonus. Awaited
      // (not fire-and-forget) so the response can report it, but it never throws: a bonus failure
      // must not turn a successful approval into an error.
      const teamBonus = await awardTeamBonusIfComplete(assignment.taskId, parentId);
      if (teamBonus.awarded) {
        for (const childId of teamBonus.childIds) {
          createNotification({
            userId: childId,
            notificationType: 'team_bonus',
            title: '🤝 Teamwork bonus!',
            message: `Everyone finished "${assignment.task.title}" — +${teamBonus.pointsEach} bonus points each.`,
            actionUrl: '/child/tasks',
            referenceType: 'task',
            referenceId: assignment.taskId,
          }).catch(() => {});
        }
      }

      if (levelUpResult?.leveledUp) {
        createNotification({
          userId: assignment.childId,
          notificationType: 'level_up',
          title: `⬆️ Level Up! You're now Level ${levelUpResult.newLevel}!`,
          message: `You levelled up and earned a bonus of ${levelUpResult.bonusPointsAwarded} points. Keep it up!`,
          actionUrl: '/child/dashboard',
          referenceType: 'child_profile',
          referenceId: assignment.childId,
        }).catch(() => {});

        EmailService.sendToFamilyParents({
          familyId,
          triggerType: 'level_up',
          subjectBuilder: () => `${assignment.child.firstName} reached Level ${levelUpResult.newLevel}! 🎉`,
          templateData: {
            childName: assignment.child.firstName,
            newLevel: levelUpResult.newLevel,
            bonusPoints: levelUpResult.bonusPointsAwarded,
          },
          referenceType: 'task_assignment',
          referenceId: assignment.id,
        }).catch((err: any) =>
          console.error('[TaskService/approveAssignment] level_up email failed:', err?.message)
        );
      }

      SocketService.emitTaskApproved(familyId, {
        assignmentId,
        taskTitle: assignment.task.title,
        childId: assignment.childId,
        pointsAwarded: result.pointsAwarded,
        xpAwarded: result.xpAwarded,
        newBalance: result.newBalance,
      });
      SocketService.emitPointsUpdated(familyId, {
        childId: assignment.childId,
        newBalance: result.newBalance,
        delta: result.pointsAwarded,
        reason: 'task_approved',
      });

      // Funnel instrumentation (roadmap 0b). Fire-and-forget: AnalyticsService swallows its own
      // failures, so a broken analytics table can never fail an approval. Ids and enums only.
      void AnalyticsService.record({
        eventType: 'TASK_APPROVED',
        familyId,
        actorRole: 'parent',
        payload: {
          assignmentId,
          childId: assignment.childId,
          pointsAwarded: result.pointsAwarded,
          difficulty: assignment.task.difficulty ?? null,
        },
      });
      // The north-star activation metric is time-to-FIRST-approved-task, so this must fire once
      // per family, not once per approval.
      void AnalyticsService.recordFirstApproval(familyId, { assignmentId });

      if (levelUpResult?.leveledUp) {
        SocketService.emitLevelUp(familyId, {
          childId: assignment.childId,
          newLevel: levelUpResult.newLevel,
          bonusPoints: levelUpResult.bonusPointsAwarded,
        });
      }

      for (const ach of unlockedAchievements) {
        SocketService.emitAchievementUnlocked(familyId, {
          childId: assignment.childId,
          achievementId: (ach as any).id ?? '',
          achievementName: (ach as any).name ?? 'Achievement',
        });
      }

      return { ...result, levelUp: levelUpResult, unlockedAchievements };
    } else {
      const updated = await prisma.taskAssignment.update({
        where: { id: assignmentId },
        data: { status: 'rejected', rejectionReason, approvedBy: parentId },
      });

      await AuditService.logAction({
        actorId: parentId,
        action: 'REJECT',
        resourceType: 'task_assignment',
        resourceId: assignmentId,
        familyId,
        ipAddress,
        metadata: { childId: assignment.childId, rejectionReason },
      });

      createNotification({
        userId: assignment.childId,
        notificationType: 'task_rejected',
        title: '❌ Task Returned',
        message: rejectionReason
          ? `"${assignment.task.title}" was returned: ${rejectionReason}`
          : `"${assignment.task.title}" was returned by your parent. Check the task for details.`,
        actionUrl: '/child/tasks',
        referenceType: 'task_assignment',
        referenceId: assignmentId,
      }).catch(() => {});

      EmailService.sendToFamilyParents({
        familyId,
        triggerType: 'task_rejected',
        subjectBuilder: () => `"${assignment.task.title}" submission rejected`,
        templateData: {
          childName: assignment.child.firstName,
          taskTitle: assignment.task.title,
          rejectionReason: rejectionReason ?? null,
        },
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      }).catch((err: any) =>
        console.error('[TaskService/approveAssignment] task_rejected email failed:', err?.message)
      );

      SocketService.emitTaskRejected(familyId, {
        assignmentId,
        taskTitle: assignment.task.title,
        childId: assignment.childId,
        rejectionReason: rejectionReason ?? null,
      });

      return { assignment: updated };
    }
  }

  /**
   * Revoke a previously APPROVED assignment and claw the points back (FR-03).
   *
   * The roadmap assumed this already existed ("points rolled back on re-reject"). It did not:
   * approveAssignment only ever matches `status: 'completed'`, so an approved assignment could
   * never be re-rejected and there was no rollback path to test.
   *
   * Decisions, because this one has real consequences for a child:
   *
   *  - The reversal is a NEW negative ledger row, never an update or delete of the original. The
   *    ledger is append-only and `balance == sum(entries)` is the invariant the tests pin; mutating
   *    history to make the arithmetic tidy would break exactly the property that makes the ledger
   *    trustworthy.
   *  - The balance MAY go negative, when the child has already spent the points. That is the honest
   *    outcome: clamping at zero would silently let them keep value that was withdrawn, and would
   *    break `balance == sum(entries)`. Redemption already checks affordability, so a negative
   *    balance blocks further spending until it is earned back rather than corrupting anything.
   *  - XP and totals are reversed too, but the child's LEVEL is left alone. De-levelling a child
   *    for a parent's correction is punitive and would cascade through achievements and level-up
   *    bonuses already granted.
   */
  static async revokeApproval(params: {
    assignmentId: string;
    familyId: string;
    parentId: string;
    reason?: string;
    ipAddress?: string;
  }) {
    const { assignmentId, familyId, parentId, reason, ipAddress } = params;

    const assignment = await prisma.taskAssignment.findFirst({
      where: { id: assignmentId, status: 'approved', task: { familyId, deletedAt: null } },
      include: { task: true, child: { include: { childProfile: true } } },
    });

    if (!assignment) throw new NotFoundError('Approved assignment not found');

    const profile = assignment.child.childProfile!;
    const points = assignment.pointsAwarded ?? 0;
    const xp = assignment.xpAwarded ?? 0;
    const newBalance = profile.pointsBalance - points;

    const result = await prisma.$transaction(async (tx) => {
      const updatedAssignment = await tx.taskAssignment.update({
        where: { id: assignmentId },
        data: {
          status: 'rejected',
          rejectionReason: reason ?? 'Approval revoked by parent',
          approvedAt: null,
          approvedBy: null,
          pointsAwarded: 0,
          xpAwarded: 0,
        },
      });

      await tx.childProfile.update({
        where: { userId: assignment.childId },
        data: {
          pointsBalance: newBalance,
          totalPointsEarned: { decrement: points },
          totalTasksCompleted: { decrement: 1 },
          experiencePoints: { decrement: xp },
          totalXpEarned: { decrement: xp },
        },
      });

      await tx.pointsLedger.create({
        data: {
          childId: assignment.childId,
          transactionType: 'adjustment',
          pointsAmount: -points,
          balanceAfter: newBalance,
          referenceType: 'task_completion',
          referenceId: assignment.id,
          description: `Approval revoked: ${assignment.task.title}`,
          createdBy: parentId,
          breakdown: { points: -points, xp: -xp },
        },
      });

      return { assignment: updatedAssignment, pointsReversed: points, xpReversed: xp, newBalance };
    });

    await AuditService.logAction({
      actorId: parentId,
      action: 'REVOKE_APPROVAL',
      resourceType: 'task_assignment',
      resourceId: assignmentId,
      familyId,
      ipAddress,
      metadata: {
        childId: assignment.childId,
        taskId: assignment.taskId,
        pointsReversed: points,
        xpReversed: xp,
        newBalance,
        wentNegative: newBalance < 0,
        reason: reason ?? null,
      },
    });

    createNotification({
      userId: assignment.childId,
      notificationType: 'task_rejected',
      title: 'A task approval was changed',
      message: `"${assignment.task.title}" was un-approved and ${points} pts were removed.${reason ? ` Reason: ${reason}` : ''}`,
      actionUrl: '/child/tasks',
      referenceType: 'task_assignment',
      referenceId: assignment.id,
    }).catch(() => {});

    return result;
  }

}
