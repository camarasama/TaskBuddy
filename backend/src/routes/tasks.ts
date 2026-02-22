/**
 * routes/tasks.ts — Updated M10 Phase 5 (Socket.io Real-time Events)
 *
 * Changes from M9:
 *  - PUT /assignments/:id/complete: createNotification() for the child (task_submitted).
 *  - PUT /assignments/:id/approve (approve): createNotification() for the child (task_approved)
 *    and optionally (level_up) if a level-up fired.
 *  - PUT /assignments/:id/approve (reject): createNotification() for the child (task_rejected).
 *  All notifications are fire-and-forget — they never block the HTTP response.
 *
 * Previous M9 history:
 *
 * Changes from M8:
 *  - PUT /assignments/:id/complete: after marking status='completed', calls
 *    EmailService.sendToFamilyParents() with triggerType='task_submitted'.
 *    The email goes to ALL parent-role users in the family (CR-08).
 *    Fire-and-forget — email failure never blocks the completion response.
 *
 *  - PUT /assignments/:id/approve (approve branch): after awarding points/XP,
 *    calls EmailService.send() with triggerType='task_approved' to the child's
 *    parent(s). Also sends 'level_up' email if checkAndApplyLevelUp fires.
 *
 *  - PUT /assignments/:id/approve (reject branch): calls EmailService.send()
 *    with triggerType='task_rejected'. The child is NOT emailed (children
 *    have no email address) — parents receive all notifications.
 *
 * All other routes are unchanged from M8.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, requireParent, requireAuth, familyIsolation } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { NotFoundError, ForbiddenError, ConflictError } from '../middleware/errorHandler';
import { GAMIFICATION } from '@taskbuddy/shared';
import { uploadPhoto } from '../middleware/upload';
import { checkAndUnlockAchievements } from '../services/achievements';
import { evaluateStreak } from '../services/streakService';
// M5 — CR-09 / CR-10 utilities
import { checkAssignmentLimits } from '../utils/assignmentLimits';
import { getTaskOverlaps } from '../utils/overlapCheck';
// M7 — CR-06: level-up detection and milestone bonus Points
import { checkAndApplyLevelUp } from '../services/levelService';
import { GAMIFICATION_M7 } from '../utils/gamification';
// BUG FIX: Use StorageService (memoryStorage buffer) instead of old disk-path approach
import { uploadFile } from '../services/storage';
// M8 — Audit logging for all mutating task routes
import { AuditService } from '../services/AuditService';
// M9 — Email notifications
import { EmailService } from '../services/email';
// M10 — Phase 4: In-app notification bell
import { createNotification } from './notifications';
// M10 — Phase 5: Real-time socket events (fire-and-forget, same pattern)
import { SocketService } from '../services/SocketService';

export const taskRouter = Router();

// All task routes require authentication and family isolation
taskRouter.use(authenticate, familyIsolation);

// Validation schemas
const createTaskSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(50).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  // M5 — CR-01: primary/secondary tag (defaults to primary)
  taskTag: z.enum(['primary', 'secondary']).optional().default('primary'),
  pointsValue: z.number().int().min(1).max(1000),
  dueDate: z.string().datetime().optional(),
  // M5 — CR-09: optional scheduling for overlap detection
  startTime: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional(),
  requiresPhotoEvidence: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  recurrencePattern: z.string().optional(),
  recurrenceConfig: z.record(z.unknown()).optional(),
  // Make assignedTo optional - parents can create unassigned tasks
  assignedTo: z.array(z.string().uuid()).optional().default([]),
});

const updateTaskSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().max(50).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  // M5 — CR-01
  taskTag: z.enum(['primary', 'secondary']).optional(),
  pointsValue: z.number().int().min(1).max(1000).optional(),
  dueDate: z.string().datetime().nullable().optional(),
  // M5 — CR-09
  startTime: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(480).nullable().optional(),
  requiresPhotoEvidence: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
});

const taskFiltersSchema = z.object({
  status: z.enum(['active', 'paused', 'archived']).optional(),
  category: z.string().optional(),
  childId: z.string().uuid().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});

const completeTaskSchema = z.object({
  note: z.string().max(500).optional(),
});

const approveTaskSchema = z.object({
  approved: z.boolean(),
  rejectionReason: z.string().max(500).optional(),
});

// GET /tasks - List tasks
taskRouter.get('/', validateQuery(taskFiltersSchema), async (req, res, next) => {
  try {
    const { status, category, childId, difficulty } = req.query as z.infer<typeof taskFiltersSchema>;

    const where: any = {
      familyId: req.familyId,
      deletedAt: null,
    };

    if (status) where.status = status;
    if (category) where.category = category;
    if (difficulty) where.difficulty = difficulty;

    // M5 — Children need to see:
    // 1. Tasks assigned to them (primary or secondary)
    // 2. Unassigned secondary tasks available to self-assign
    if (req.user!.role === 'child') {
      const targetChildId = req.user!.userId;
      
      where.OR = [
        {
          assignments: {
            some: { childId: targetChildId },
          },
        },
        {
          taskTag: 'secondary',
          assignments: {
            none: {},
          },
        },
      ];
    } else if (childId) {
      where.assignments = {
        some: { childId },
      };
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true },
        },
        assignments: {
          include: {
            child: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true },
            },
          },
        },
      },
      orderBy: [
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    // M5 — CR-10: For child role, compute hasPendingPrimaries and attach
    // canSelfAssign to each secondary task so the UI can show the lock state.
    if (req.user!.role === 'child') {
      const childId = req.user!.userId;
      const hasPendingPrimaries = await prisma.taskAssignment.count({
        where: {
          childId,
          status: { in: ['pending', 'in_progress'] },
          task: { taskTag: 'primary' },
        },
      }) > 0;

      const tasksWithFlags = tasks.map((task) => {
        const alreadyAssigned = task.assignments.some(a => a.childId === childId);
        const canSelfAssign = 
          task.taskTag === 'secondary' && 
          !hasPendingPrimaries && 
          !alreadyAssigned;

        return {
          ...task,
          canSelfAssign,
        };
      });

      return res.json({
        success: true,
        data: { tasks: tasksWithFlags, hasPendingPrimaries },
      });
    }

    res.json({
      success: true,
      data: { tasks },
    });
  } catch (error) {
    next(error);
  }
});

// POST /tasks - Create a task (parents only)
taskRouter.post('/', requireParent, validateBody(createTaskSchema), async (req, res, next) => {
  try {
    const { assignedTo = [], dueDate, startTime, estimatedMinutes, taskTag = 'primary', ...taskData } = req.body;

    // If children are assigned, verify they belong to the family
    if (assignedTo.length > 0) {
      const children = await prisma.user.findMany({
        where: {
          id: { in: assignedTo },
          familyId: req.familyId,
          role: 'child',
          deletedAt: null,
        },
      });

      if (children.length !== assignedTo.length) {
        throw new NotFoundError('One or more children not found');
      }

      // M5 — CR-10: Hard assignment limit check for every assigned child
      for (const childId of assignedTo) {
        const limitCheck = await checkAssignmentLimits(childId, taskTag);
        if (!limitCheck.allowed) {
          const child = children.find((c) => c.id === childId);
          const name = child ? child.firstName : 'A child';
          throw new ConflictError(`${name}: ${limitCheck.reason}`);
        }
      }
    }

    // M5 — CR-09: Soft overlap check — gather warnings across all assigned children
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parsedStartTime = startTime ? new Date(startTime) : null;
    const allWarnings: (typeof import('../utils/overlapCheck').getTaskOverlaps extends (...args: any[]) => Promise<infer R> ? R : never) = [];

    if (assignedTo.length > 0) {
      for (const childId of assignedTo) {
        const overlaps = await getTaskOverlaps(
          childId,
          parsedStartTime,
          estimatedMinutes ?? null,
          today
        );
        allWarnings.push(...overlaps);
      }
    }

    // Create task and assignments in transaction
    const result = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          ...taskData,
          taskTag,
          familyId: req.familyId!,
          createdBy: req.user!.userId,
          dueDate: dueDate ? new Date(dueDate) : undefined,
          startTime: parsedStartTime ?? undefined,
          estimatedMinutes: estimatedMinutes ?? undefined,
        },
      });

      const assignments = assignedTo.length > 0
        ? await Promise.all(
            assignedTo.map((childId: string) =>
              tx.taskAssignment.create({
                data: {
                  taskId: task.id,
                  childId,
                  instanceDate: today,
                },
                include: {
                  child: {
                    select: { id: true, firstName: true, lastName: true },
                  },
                },
              })
            )
          )
        : [];

      return { task, assignments };
    });

    // M8 — Audit: task created
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'task',
      resourceId: result.task.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: {
        title: result.task.title,
        taskTag: result.task.taskTag,
        assignedTo,
        isRecurring: result.task.isRecurring,
      },
    });

    // M10 — In-app notification: notify each assigned child that a new task awaits them.
    // Fire-and-forget — never blocks the HTTP response.
    for (const assignment of result.assignments) {
      createNotification({
        userId: assignment.childId,
        notificationType: 'task_assigned',
        title: '📋 New Task Assigned',
        message: `You have a new task: "${result.task.title}". Earn ${result.task.pointsValue} pts when approved!`,
        actionUrl: '/child/tasks',
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      }).catch(() => {}); // non-fatal
    }

    res.status(201).json({
      success: true,
      data: { ...result, warnings: allWarnings },
    });
  } catch (error) {
    next(error);
  }
});

// GET /tasks/:id - Get a specific task
taskRouter.get('/:id', async (req, res, next) => {
  try {
    const task = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        deletedAt: null,
      },
      include: {
        creator: {
          select: { id: true, firstName: true, lastName: true },
        },
        assignments: {
          include: {
            child: {
              select: { id: true, firstName: true, lastName: true, avatarUrl: true },
            },
            evidence: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    res.json({
      success: true,
      data: { task },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /tasks/:id - Update a task (parents only)
taskRouter.put('/:id', requireParent, validateBody(updateTaskSchema), async (req, res, next) => {
  try {
    const task = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        deletedAt: null,
      },
      include: {
        assignments: { select: { childId: true } },
      },
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const { dueDate, startTime, estimatedMinutes, ...updateData } = req.body;

    // M5 — CR-09: Re-run overlap check if scheduling fields changed
    const warnings: Awaited<ReturnType<typeof getTaskOverlaps>> = [];
    const timingChanged =
      startTime !== undefined || estimatedMinutes !== undefined;

    if (timingChanged) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const effectiveStartTime =
        startTime !== undefined
          ? startTime !== null ? new Date(startTime) : null
          : task.startTime;
      const effectiveMinutes =
        estimatedMinutes !== undefined ? estimatedMinutes : task.estimatedMinutes;

      for (const { childId } of task.assignments) {
        const overlaps = await getTaskOverlaps(
          childId,
          effectiveStartTime,
          effectiveMinutes,
          today,
          task.id
        );
        warnings.push(...overlaps);
      }
    }

    const updatedTask = await prisma.task.update({
      where: { id: req.params.id },
      data: {
        ...updateData,
        dueDate: dueDate === null ? null : dueDate ? new Date(dueDate) : undefined,
        startTime: startTime === null ? null : startTime ? new Date(startTime) : undefined,
        estimatedMinutes: estimatedMinutes === null ? null : estimatedMinutes ?? undefined,
      },
      include: {
        assignments: {
          include: {
            child: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });

    // M8 — Audit: task updated
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'task',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { changes: req.body },
    });

    res.json({
      success: true,
      data: { task: updatedTask, warnings },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /tasks/:id - Delete a task (soft delete, parents only)
taskRouter.delete('/:id', requireParent, async (req, res, next) => {
  try {
    const task = await prisma.task.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        deletedAt: null,
      },
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    await prisma.task.update({
      where: { id: req.params.id },
      data: { deletedAt: new Date() },
    });

    // M8 — Audit: task soft-deleted
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'DELETE',
      resourceType: 'task',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { title: task.title, taskTag: task.taskTag },
    });

    res.json({
      success: true,
      data: { message: 'Task deleted' },
    });
  } catch (error) {
    next(error);
  }
});

// ============================================
// ASSIGNMENT ROUTES
// ============================================

// GET /tasks/assignments/me - Get assignments for current user
taskRouter.get('/assignments/me', async (req, res, next) => {
  try {
    const where: any = {};

    if (req.user!.role === 'child') {
      where.childId = req.user!.userId;
    } else {
      const { childId, status } = req.query;
      if (childId) where.childId = childId;
      if (status) where.status = status;
    }

    where.task = {
      familyId: req.familyId,
      deletedAt: null,
    };

    const assignments = await prisma.taskAssignment.findMany({
      where,
      include: {
        task: true,
        child: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        },
        evidence: true,
      },
      orderBy: [
        { status: 'asc' },
        { instanceDate: 'desc' },
      ],
    });

    res.json({
      success: true,
      data: { assignments },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /tasks/assignments/:id/complete - Mark assignment as complete
taskRouter.put('/assignments/:id/complete', validateBody(completeTaskSchema), async (req, res, next) => {
  try {
    const assignment = await prisma.taskAssignment.findFirst({
      where: {
        id: req.params.id,
        task: {
          familyId: req.familyId,
          deletedAt: null,
        },
      },
      include: {
        task: true,
        child: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundError('Assignment not found');
    }

    if (req.user!.role === 'child' && assignment.childId !== req.user!.userId) {
      throw new ForbiddenError('Cannot complete another child\'s task');
    }

    // Allow resubmission from 'rejected' status (child can fix and resubmit)
    if (!['pending', 'in_progress', 'rejected'].includes(assignment.status)) {
      throw new ConflictError('Task is already completed or approved');
    }

    // Update assignment
    const updated = await prisma.taskAssignment.update({
      where: { id: req.params.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        // Clear rejection reason when child resubmits
        rejectionReason: null,
      },
      include: {
        task: true,
        child: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });

    // Add note as evidence if provided
    if (req.body.note) {
      await prisma.taskEvidence.create({
        data: {
          assignmentId: assignment.id,
          evidenceType: 'note',
          note: req.body.note,
        },
      });
    }

    // BUG-02 FIX: Auto-approve if task.autoApprove is true
    if (assignment.task.autoApprove) {
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
            where: { id: req.params.id },
            data: {
              status: 'approved',
              approvedAt: new Date(),
              pointsAwarded: basePoints,
              xpAwarded: baseXp,
            },
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

          return {
            assignment: approvedAssignment,
            pointsAwarded: basePoints,
            xpAwarded: baseXp,
            newBalance: newPointsBalance,
          };
        });

        const levelUpResult = await checkAndApplyLevelUp(assignment.childId, oldLevel);
        const unlockedAchievements = await checkAndUnlockAchievements(assignment.childId);
        await evaluateStreak(assignment.childId, req.familyId!);

        res.json({
          success: true,
          data: {
            ...autoApproveResult,
            autoApproved: true,
            levelUp: levelUpResult,
            unlockedAchievements,
          },
        });
        return;
      }
    }

    // M8 — Audit: assignment marked complete by child
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'COMPLETE',
      resourceType: 'task_assignment',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { taskId: assignment.taskId, taskTitle: assignment.task.title },
    });

    // M9 — Task submitted email: notify ALL parent-role users in the family (CR-08).
    // Uses sendToFamilyParents() which respects the 'task_submitted' preference toggle.
    // Fire-and-forget — never blocks the response.
    EmailService.sendToFamilyParents({
      familyId: req.familyId!,
      triggerType: 'task_submitted',
      subjectBuilder: (parent) =>
        `${assignment.child.firstName} completed "${assignment.task.title}"`,
      templateData: {
        childName: assignment.child.firstName,
        taskTitle: assignment.task.title,
        completedAt: new Date().toISOString(),
        assignmentId: assignment.id,
      },
      referenceType: 'task_assignment',
      referenceId: assignment.id,
    }).catch((err) =>
      console.error('[tasks/complete] task_submitted email failed (non-fatal):', err?.message)
    );

    // M10 — In-app notification: child sees "submitted" confirmation in their bell;
    // parents will see the pending-approval badge on the tasks page.
    createNotification({
      userId: req.user!.userId,
      notificationType: 'task_submitted',
      title: 'Task Submitted ✓',
      message: `"${assignment.task.title}" is awaiting parent approval.`,
      actionUrl: `/child/tasks`,
      referenceType: 'task_assignment',
      referenceId: assignment.id,
    }).catch(() => {}); // non-fatal

    res.json({
      success: true,
      data: { assignment: updated },
    });
  } catch (error) {
    next(error);
  }
});

// POST /tasks/assignments/:id/upload - Upload photo evidence for a task
taskRouter.post('/assignments/:id/upload', uploadPhoto.single('photo'), async (req, res, next) => {
  try {
    const assignment = await prisma.taskAssignment.findFirst({
      where: {
        id: req.params.id,
        task: {
          familyId: req.familyId,
          deletedAt: null,
        },
      },
    });

    if (!assignment) {
      throw new NotFoundError('Assignment not found');
    }

    if (req.user!.role === 'child' && assignment.childId !== req.user!.userId) {
      throw new ForbiddenError('Cannot upload evidence for another child\'s task');
    }

    if (!req.file) {
      throw new ConflictError('No photo file provided');
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const apiBaseUrl = `${protocol}://${host}`;

    const uploadResult = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      apiBaseUrl,
    );

    const evidence = await prisma.taskEvidence.create({
      data: {
        assignmentId: assignment.id,
        evidenceType: 'photo',
        fileUrl: uploadResult.fileUrl,
        fileKey: uploadResult.fileKey,
        thumbnailUrl: uploadResult.thumbnailUrl,
        fileSizeBytes: uploadResult.fileSizeBytes,
        mimeType: uploadResult.mimeType,
      },
    });

    res.json({
      success: true,
      data: {
        evidence: {
          id: evidence.id,
          fileUrl: evidence.fileUrl,
          thumbnailUrl: evidence.thumbnailUrl,
          mimeType: evidence.mimeType,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /tasks/assignments/:id/approve - Approve or reject assignment (parents only)
// M7 — CR-06: Awards XP and Points as two independent operations.
taskRouter.put('/assignments/:id/approve', requireParent, validateBody(approveTaskSchema), async (req, res, next) => {
  try {
    const assignment = await prisma.taskAssignment.findFirst({
      where: {
        id: req.params.id,
        status: 'completed',
        task: {
          familyId: req.familyId,
          deletedAt: null,
        },
      },
      include: {
        task: true,
        child: {
          include: { childProfile: true },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundError('Completed assignment not found');
    }

    const { approved, rejectionReason } = req.body;

    if (approved) {
      const profile = assignment.child.childProfile!;

      // M7 — CR-06: Map difficulty to XP using shared gamification constants
      const difficulty = (assignment.task.difficulty ?? 'medium') as keyof typeof GAMIFICATION_M7.TASK_XP;
      const baseXp = GAMIFICATION_M7.TASK_XP[difficulty] ?? GAMIFICATION_M7.TASK_XP.medium;

      const basePoints = assignment.task.pointsValue;
      const newPointsBalance = profile.pointsBalance + basePoints;
      const newXp = profile.experiencePoints + baseXp;
      const newTotalXpEarned = profile.totalXpEarned + baseXp;
      const oldLevel = profile.level;

      const result = await prisma.$transaction(async (tx) => {
        const updatedAssignment = await tx.taskAssignment.update({
          where: { id: req.params.id },
          data: {
            status: 'approved',
            approvedAt: new Date(),
            approvedBy: req.user!.userId,
            pointsAwarded: basePoints,
            xpAwarded: baseXp,
          },
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
            createdBy: req.user!.userId,
            breakdown: { points: basePoints, xp: baseXp },
          },
        });

        return {
          assignment: updatedAssignment,
          pointsAwarded: basePoints,
          xpAwarded: baseXp,
          newBalance: newPointsBalance,
        };
      });

      const levelUpResult = await checkAndApplyLevelUp(assignment.childId, oldLevel);
      const unlockedAchievements = await checkAndUnlockAchievements(assignment.childId);
      await evaluateStreak(assignment.childId, req.familyId!);

      // M8 — Audit: assignment approved by parent
      await AuditService.logAction({
        actorId: req.user!.userId,
        action: 'APPROVE',
        resourceType: 'task_assignment',
        resourceId: req.params.id,
        familyId: req.familyId,
        ipAddress: req.ip,
        metadata: {
          childId: assignment.childId,
          taskId: assignment.taskId,
          pointsAwarded: result.pointsAwarded,
          xpAwarded: result.xpAwarded,
          levelUp: !!levelUpResult?.leveledUp,
        },
      });

      // M9 — Task approved email: notify all parents.
      // Parents are the audience because children have no email address.
      EmailService.sendToFamilyParents({
        familyId: req.familyId!,
        triggerType: 'task_approved',
        subjectBuilder: () =>
          `"${assignment.task.title}" approved for ${assignment.child.firstName}`,
        templateData: {
          childName: assignment.child.firstName,
          taskTitle: assignment.task.title,
          pointsAwarded: result.pointsAwarded,
          xpAwarded: result.xpAwarded,
          newBalance: result.newBalance,
        },
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      }).catch((err) =>
        console.error('[tasks/approve] task_approved email failed (non-fatal):', err?.message)
      );

      // M10 — In-app notification: tell the child their task was approved
      createNotification({
        userId: assignment.childId,
        notificationType: 'task_approved',
        title: '🎉 Task Approved!',
        message: `"${assignment.task.title}" approved! You earned +${result.pointsAwarded} pts and +${result.xpAwarded} XP.`,
        actionUrl: `/child/tasks`,
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      }).catch(() => {}); // non-fatal

      // M10 — Level-up in-app notification (only fires when levelUpResult exists)
      if (levelUpResult?.leveledUp) {
        createNotification({
          userId: assignment.childId,
          notificationType: 'level_up',
          title: `⬆️ Level Up! You're now Level ${levelUpResult.newLevel}!`,
          message: `You levelled up and earned a bonus of ${levelUpResult.bonusPointsAwarded} points. Keep it up!`,
          actionUrl: `/child/dashboard`,
          referenceType: 'child_profile',
          referenceId: assignment.childId,
        }).catch(() => {}); // non-fatal
      }

      // M9 — Level-up email if the approval triggered a level-up
      if (levelUpResult?.leveledUp) {
        EmailService.sendToFamilyParents({
          familyId: req.familyId!,
          triggerType: 'level_up',
          subjectBuilder: () =>
            `${assignment.child.firstName} reached Level ${levelUpResult.newLevel}! 🎉`,
          templateData: {
            childName: assignment.child.firstName,
            newLevel: levelUpResult.newLevel,
            bonusPoints: levelUpResult.bonusPointsAwarded,
          },
          referenceType: 'task_assignment',
          referenceId: assignment.id,
        }).catch((err) =>
          console.error('[tasks/approve] level_up email failed (non-fatal):', err?.message)
        );
      }

      // M10 — Phase 5: Real-time socket events pushed to family room + child user room
      SocketService.emitTaskApproved(req.familyId!, {
        assignmentId: req.params.id,
        taskTitle: assignment.task.title,
        childId: assignment.childId,
        pointsAwarded: result.pointsAwarded,
        xpAwarded: result.xpAwarded,
        newBalance: result.newBalance,
      });
      SocketService.emitPointsUpdated(req.familyId!, {
        childId: assignment.childId,
        newBalance: result.newBalance,
        delta: result.pointsAwarded,
        reason: 'task_approved',
      });
      if (levelUpResult?.leveledUp) {
        SocketService.emitLevelUp(req.familyId!, {
          childId: assignment.childId,
          newLevel: levelUpResult.newLevel,
          bonusPoints: levelUpResult.bonusPointsAwarded,
        });
      }
      if (unlockedAchievements.length > 0) {
        for (const ach of unlockedAchievements) {
          SocketService.emitAchievementUnlocked(req.familyId!, {
            childId: assignment.childId,
            achievementId: (ach as any).id ?? '',
            achievementName: (ach as any).name ?? 'Achievement',
          });
        }
      }

      res.json({
        success: true,
        data: {
          ...result,
          levelUp: levelUpResult,
          unlockedAchievements,
        },
      });
    } else {
      // Reject assignment
      const updated = await prisma.taskAssignment.update({
        where: { id: req.params.id },
        data: {
          status: 'rejected',
          rejectionReason,
          approvedBy: req.user!.userId,
        },
      });

      // M8 — Audit: assignment rejected by parent
      await AuditService.logAction({
        actorId: req.user!.userId,
        action: 'REJECT',
        resourceType: 'task_assignment',
        resourceId: req.params.id,
        familyId: req.familyId,
        ipAddress: req.ip,
        metadata: { childId: assignment.childId, rejectionReason },
      });

      // M10 — In-app notification: tell the child their submission was returned
      createNotification({
        userId: assignment.childId,
        notificationType: 'task_rejected',
        title: '❌ Task Returned',
        message: rejectionReason
          ? `"${assignment.task.title}" was returned: ${rejectionReason}`
          : `"${assignment.task.title}" was returned by your parent. Check the task for details.`,
        actionUrl: `/child/tasks`,
        referenceType: 'task_assignment',
        referenceId: req.params.id,
      }).catch(() => {}); // non-fatal

      // M9 — Task rejected email: notify all parents
      EmailService.sendToFamilyParents({
        familyId: req.familyId!,
        triggerType: 'task_rejected',
        subjectBuilder: () =>
          `"${assignment.task.title}" submission rejected`,
        templateData: {
          childName: assignment.child.firstName,
          taskTitle: assignment.task.title,
          rejectionReason: rejectionReason ?? null,
        },
        referenceType: 'task_assignment',
        referenceId: assignment.id,
      }).catch((err) =>
        console.error('[tasks/approve] task_rejected email failed (non-fatal):', err?.message)
      );

      // M10 — Phase 5: Push rejection to child in real-time
      SocketService.emitTaskRejected(req.familyId!, {
        assignmentId: req.params.id,
        taskTitle: assignment.task.title,
        childId: assignment.childId,
        rejectionReason: rejectionReason ?? null,
      });

      res.json({
        success: true,
        data: { assignment: updated },
      });
    }
  } catch (error) {
    next(error);
  }
});

// GET /tasks/assignments/pending - Get pending approvals (parents only)
taskRouter.get('/assignments/pending', requireParent, async (req, res, next) => {
  try {
    const assignments = await prisma.taskAssignment.findMany({
      where: {
        status: 'completed',
        task: {
          familyId: req.familyId,
          deletedAt: null,
        },
      },
      include: {
        task: true,
        child: {
          select: { id: true, firstName: true, lastName: true, avatarUrl: true },
        },
        evidence: true,
      },
      orderBy: { completedAt: 'asc' },
    });

    res.json({
      success: true,
      data: { assignments },
    });
  } catch (error) {
    next(error);
  }
});

// POST /tasks/assignments/self-assign - Child self-assigns a secondary task (M5 — CR-10)
taskRouter.post('/assignments/self-assign', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.role !== 'child') {
      throw new ForbiddenError('Only children can self-assign tasks');
    }

    const { taskId } = req.body;
    const childId = req.user!.userId;

    const task = await prisma.task.findFirst({
      where: {
        id: taskId,
        familyId: req.familyId,
        taskTag: 'secondary',
        status: 'active',
        deletedAt: null,
      },
    });

    if (!task) {
      throw new NotFoundError('Secondary task not found');
    }

    const pendingPrimaries = await prisma.taskAssignment.count({
      where: {
        childId,
        status: { in: ['pending', 'in_progress'] },
        task: { taskTag: 'primary' },
      },
    });

    if (pendingPrimaries > 0) {
      throw new ConflictError('Complete your primary tasks before self-assigning bonus tasks');
    }

    const limitCheck = await checkAssignmentLimits(childId, 'secondary');
    if (!limitCheck.allowed) {
      throw new ConflictError(limitCheck.reason ?? 'Assignment limit reached');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const assignment = await prisma.taskAssignment.create({
      data: {
        taskId,
        childId,
        instanceDate: today,
      },
      include: {
        task: true,
      },
    });

    // M8 — Audit: child self-assigned a secondary task
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'SELF_ASSIGN',
      resourceType: 'task_assignment',
      resourceId: assignment.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { taskId, taskTitle: assignment.task.title },
    });

    res.status(201).json({
      success: true,
      data: { assignment },
    });
  } catch (error) {
    next(error);
  }
});