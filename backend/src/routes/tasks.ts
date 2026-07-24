/**
 * routes/tasks.ts - Updated M10 Phase 5 (Socket.io Real-time Events)
 *
 * Changes from M9:
 *  - PUT /assignments/:id/complete: createNotification() for the child (task_submitted).
 *  - PUT /assignments/:id/approve (approve): createNotification() for the child (task_approved)
 *    and optionally (level_up) if a level-up fired.
 *  - PUT /assignments/:id/approve (reject): createNotification() for the child (task_rejected).
 *  All notifications are fire-and-forget - they never block the HTTP response.
 *
 * Previous M9 history:
 *
 * Changes from M8:
 *  - PUT /assignments/:id/complete: after marking status='completed', calls
 *    EmailService.sendToFamilyParents() with triggerType='task_submitted'.
 *    The email goes to ALL parent-role users in the family (CR-08).
 *    Fire-and-forget - email failure never blocks the completion response.
 *
 *  - PUT /assignments/:id/approve (approve branch): after awarding points/XP,
 *    calls EmailService.send() with triggerType='task_approved' to the child's
 *    parent(s). Also sends 'level_up' email if checkAndApplyLevelUp fires.
 *
 *  - PUT /assignments/:id/approve (reject branch): calls EmailService.send()
 *    with triggerType='task_rejected'. The child is NOT emailed (children
 *    have no email address) - parents receive all notifications.
 *
 * All other routes are unchanged from M8.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, requireParent, requireAuth, familyIsolation } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { toSkipTake, buildMeta } from '../utils/pagination';
import { NotFoundError, ForbiddenError, ConflictError } from '../middleware/errorHandler';
import { difficultyFromPoints } from '@taskbuddy/shared';
import { uploadPhoto } from '../middleware/upload';
// M5 - CR-09 / CR-10 utilities
import { checkAssignmentLimits } from '../utils/assignmentLimits';
import { getTaskOverlaps } from '../utils/overlapCheck';
// BUG FIX: Use StorageService (memoryStorage buffer) instead of old disk-path approach
import { uploadFile, withEvidenceUrls, withEvidenceUrlsList } from '../services/storage';
// M8 - Audit logging for all mutating task routes
import { AuditService } from '../services/AuditService';
// P4 - Business logic delegated to TaskService
import { TaskService } from '../services/TaskService';
import { createNotification } from './notifications';
import { emitTaskComment } from '../services/SocketService';

export const taskRouter = Router();

// All task routes require authentication and family isolation
taskRouter.use(authenticate, familyIsolation);

// Validation schemas
const createTaskSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(50).optional(),
  // difficulty derived server-side from pointsValue via difficultyFromPoints()
  // M5 - CR-01: primary/secondary tag (defaults to primary)
  taskTag: z.enum(['primary', 'secondary']).optional().default('primary'),
  pointsValue: z.number().int().min(5).max(1000),
  dueDate: z.string().datetime().refine(
    (v) => new Date(v) > new Date(),
    { message: 'Due date must be in the future' }
  ),
  // M5 - CR-09: optional scheduling for overlap detection
  startTime: z.string().datetime().optional(),
  estimatedMinutes: z.number().int().min(1).max(480).optional(),
  requiresPhotoEvidence: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  recurrencePattern: z.string().optional(),
  recurrenceConfig: z.record(z.unknown()).optional(),
  // Make assignedTo optional - parents can create unassigned tasks
  assignedTo: z.array(z.string().uuid()).optional().default([]),
  // How many different children can claim this task from the pool (null = unlimited)
  maxClaimsTotal: z.number().int().min(1).max(100).nullable().optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(1000).optional(),
  category: z.string().max(50).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  // M5 - CR-01
  taskTag: z.enum(['primary', 'secondary']).optional(),
  pointsValue: z.number().int().min(1).max(1000).optional(),
  dueDate: z.string().datetime().nullable().optional()
    .refine((v) => v === null || v === undefined || new Date(v) > new Date(), {
      message: 'Due date must be in the future',
    }),
  // M5 - CR-09
  startTime: z.string().datetime().nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(480).nullable().optional(),
  requiresPhotoEvidence: z.boolean().optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  maxClaimsTotal: z.number().int().min(1).max(100).nullable().optional(),
  isRecurring: z.boolean().optional(),
  recurrencePattern: z.enum(['daily', 'weekly', 'weekdays', 'weekends']).optional(),
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

    // Children need to see:
    // 1. Their own assignments (active tasks only - not archived)
    // 2. Unassigned active tasks available to self-assign
    if (req.user!.role === 'child') {
      const targetChildId = req.user!.userId;

      // Never show archived tasks to children
      if (!status) where.status = { not: 'archived' };

      where.OR = [
        // Already assigned to this child (always show their own tasks)
        { assignments: { some: { childId: targetChildId } } },
        // Pool: secondary tasks this child hasn't claimed yet
        { taskTag: 'secondary', NOT: { assignments: { some: { childId: targetChildId } } } },
        // Pool: primary tasks this child hasn't claimed yet
        { taskTag: 'primary', NOT: { assignments: { some: { childId: targetChildId } } } },
      ];
    } else if (childId) {
      where.assignments = {
        some: { childId },
      };
    }

    const { skip, take, page, limit } = toSkipTake(req.query);
    const total = await prisma.task.count({ where });
    const tasks = await prisma.task.findMany({
      skip,
      take,
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
      distinct: ['id'],
    });

    // M5 - CR-10: For child role, compute hasPendingPrimaries and attach
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

      const tasksWithFlags = tasks
        .filter((task) => {
          // Filter pool tasks that have reached their claim limit.
          // Expired assignments don't count as "already assigned" - the child can re-claim.
          const alreadyAssigned = task.assignments.some(a => a.childId === childId && a.status !== 'expired');
          if (alreadyAssigned) return true; // always keep child's own active tasks
          if (task.maxClaimsTotal == null) return true; // no cap
          const claimedCount = task.assignments.filter(a => a.status !== 'expired').length;
          return claimedCount < task.maxClaimsTotal;
        })
        .map((task) => {
          const alreadyAssigned = task.assignments.some(a => a.childId === childId && a.status !== 'expired');
          const claimedCount = task.assignments.filter(a => a.status !== 'expired').length;
          const claimsRemaining = task.maxClaimsTotal != null
            ? task.maxClaimsTotal - claimedCount
            : null;
          const canSelfAssign =
            (task.taskTag === 'secondary' || task.taskTag === 'primary') &&
            !hasPendingPrimaries &&
            !alreadyAssigned;

          return {
            ...task,
            canSelfAssign,
            claimedCount,
            claimsRemaining,
          };
        });

      return res.json({
        success: true,
        data: { tasks: tasksWithFlags, hasPendingPrimaries, pagination: buildMeta(total, page, limit) },
      });
    }

    res.json({
      success: true,
      data: { tasks, pagination: buildMeta(total, page, limit) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /tasks - Create a task (parents only)
taskRouter.post('/', requireParent, validateBody(createTaskSchema), async (req, res, next) => {
  try {
    const { assignedTo = [], dueDate, startTime, estimatedMinutes, taskTag = 'primary', ...taskData } = req.body;
    const difficulty = difficultyFromPoints((taskData as { pointsValue: number }).pointsValue);
    const result = await TaskService.createTask({
      familyId: req.familyId!,
      createdBy: req.user!.userId,
      taskTag,
      assignedTo,
      dueDate,
      startTime,
      estimatedMinutes,
      taskData: { ...taskData, difficulty },
      ipAddress: req.ip,
    });
    res.status(201).json({ success: true, data: result });
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
          where: { status: { in: ['pending', 'in_progress', 'completed', 'approved', 'rejected'] } },
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

    // Attach short-lived presigned URLs to each assignment's evidence (private on R2).
    for (const a of task.assignments) {
      a.evidence = await withEvidenceUrlsList(a.evidence);
    }

    res.json({
      success: true,
      data: { task },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /tasks/:id/assignments/:childId - Parent removes a child's assignment
taskRouter.delete('/:id/assignments/:childId', requireParent, async (req, res, next) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, familyId: req.familyId, deletedAt: null },
    });
    if (!task) throw new NotFoundError('Task not found');

    const assignment = await prisma.taskAssignment.findFirst({
      where: { taskId: req.params.id, childId: req.params.childId },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');

    await prisma.taskAssignment.delete({ where: { id: assignment.id } });

    res.json({ success: true, data: { message: 'Assignment removed' } });
  } catch (error) {
    next(error);
  }
});

// POST /tasks/:id/assign - Parent assigns task to a new child
taskRouter.post('/:id/assign', requireParent, async (req, res, next) => {
  try {
    const { childId } = req.body as { childId: string };
    const task = await prisma.task.findFirst({
      where: { id: req.params.id, familyId: req.familyId, deletedAt: null },
    });
    if (!task) throw new NotFoundError('Task not found');

    const child = await prisma.user.findFirst({
      where: { id: childId, familyId: req.familyId, role: 'child', deletedAt: null },
    });
    if (!child) throw new NotFoundError('Child not found in this family');

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const existing = await prisma.taskAssignment.findFirst({
      where: { taskId: req.params.id, childId, instanceDate: today },
    });
    if (existing) throw new ConflictError('Child already has this task assigned');

    const assignment = await prisma.taskAssignment.create({
      data: { taskId: req.params.id, childId, instanceDate: today },
      include: { child: { select: { id: true, firstName: true, lastName: true } } },
    });

    await createNotification({
      userId: childId,
      notificationType: 'task_assigned',
      title: '📋 Task Assigned',
      message: `You have been assigned: "${task.title}"`,
      actionUrl: '/child/tasks',
    }).catch(() => {});

    res.status(201).json({ success: true, data: { assignment } });
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

    // M5 - CR-09: Re-run overlap check if scheduling fields changed
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

    // When archiving a task, expire all active assignments and notify affected children
    if (updateData.status === 'archived') {
      const activeAssignments = await prisma.taskAssignment.findMany({
        where: { taskId: req.params.id, status: { in: ['pending', 'in_progress'] } },
        select: { id: true, childId: true },
      });
      if (activeAssignments.length > 0) {
        await prisma.taskAssignment.updateMany({
          where: { id: { in: activeAssignments.map((a) => a.id) } },
          data: { status: 'expired' },
        });
        for (const a of activeAssignments) {
          createNotification({
            userId: a.childId,
            notificationType: 'task_archived',
            title: 'Task Removed',
            message: `"${task.title}" has been archived by a parent and removed from your task list.`,
          }).catch(() => {});
        }
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

    // M8 - Audit: task updated
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

    // M8 - Audit: task soft-deleted
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

    const { skip, take, page, limit } = toSkipTake(req.query);
    const total = await prisma.taskAssignment.count({ where });
    const assignments = await prisma.taskAssignment.findMany({
      skip,
      take,
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

    for (const a of assignments) {
      a.evidence = await withEvidenceUrlsList(a.evidence);
    }

    res.json({
      success: true,
      data: { assignments, pagination: buildMeta(total, page, limit) },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /tasks/assignments/:id/start - Child starts a task (pending → in_progress, stamps startedAt)
taskRouter.put('/assignments/:id/start', async (req, res, next) => {
  try {
    const assignment = await prisma.taskAssignment.findFirst({
      where: {
        id: req.params.id,
        task: { familyId: req.familyId, deletedAt: null },
      },
      select: { id: true, childId: true, status: true },
    });

    if (!assignment) throw new NotFoundError('Assignment not found');
    if (req.user!.role === 'child' && assignment.childId !== req.user!.userId) {
      throw new ForbiddenError("Cannot start another child's task");
    }
    if (assignment.status !== 'pending') {
      throw new ConflictError(`Task is already ${assignment.status} - cannot start again`);
    }

    const updated = await prisma.taskAssignment.update({
      where: { id: req.params.id },
      data: { status: 'in_progress', startedAt: new Date() },
    });

    res.json({ success: true, data: { assignment: updated } });
  } catch (error) {
    next(error);
  }
});

// PUT /tasks/assignments/:id/complete - Mark assignment as complete
taskRouter.put('/assignments/:id/complete', validateBody(completeTaskSchema), async (req, res, next) => {
  try {
    const result = await TaskService.submitCompletion({
      assignmentId: req.params.id,
      familyId: req.familyId!,
      userId: req.user!.userId,
      userRole: req.user!.role,
      note: req.body.note,
      ipAddress: req.ip,
    });
    res.json({ success: true, data: result });
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
      { kind: 'evidence' },
    );

    const evidence = await prisma.taskEvidence.create({
      data: {
        assignmentId: assignment.id,
        evidenceType: 'photo',
        fileUrl: uploadResult.fileUrl,
        fileKey: uploadResult.fileKey,
        thumbnailKey: uploadResult.thumbnailKey,
        thumbnailUrl: uploadResult.thumbnailUrl,
        fileSizeBytes: uploadResult.fileSizeBytes,
        mimeType: uploadResult.mimeType,
      },
    });

    // Serve back presigned URLs (the stored evidence URLs are empty on R2 - the objects are private).
    const signed = await withEvidenceUrls(evidence);

    res.json({
      success: true,
      data: {
        evidence: {
          id: evidence.id,
          fileUrl: signed.fileUrl,
          thumbnailUrl: signed.thumbnailUrl,
          mimeType: evidence.mimeType,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /tasks/assignments/:id/approve - Approve or reject assignment (parents only)
taskRouter.put('/assignments/:id/approve', requireParent, validateBody(approveTaskSchema), async (req, res, next) => {
  try {
    const result = await TaskService.approveAssignment({
      assignmentId: req.params.id,
      familyId: req.familyId!,
      parentId: req.user!.userId,
      approved: req.body.approved,
      rejectionReason: req.body.rejectionReason,
      ipAddress: req.ip,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// PUT /tasks/assignments/:id/revoke-approval - Undo an approval and claw the points back (FR-03).
// Separate from /approve on purpose: /approve only ever matches a `completed` assignment, and
// conflating "judge a submission" with "reverse a judgement already made" in one endpoint would
// make it easy to reverse an approval by accident.
taskRouter.put(
  '/assignments/:id/revoke-approval',
  requireParent,
  validateBody(z.object({ reason: z.string().min(1).max(500).optional() })),
  async (req, res, next) => {
    try {
      const result = await TaskService.revokeApproval({
        assignmentId: req.params.id,
        familyId: req.familyId!,
        parentId: req.user!.userId,
        reason: req.body.reason,
        ipAddress: req.ip,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

// PUT /tasks/assignments/:id/reset - Reset a completed/approved assignment back to pending
taskRouter.put('/assignments/:id/reset', requireParent, async (req, res, next) => {
  try {
    const assignment = await prisma.taskAssignment.findFirst({
      where: {
        id: req.params.id,
        task: { familyId: req.familyId, deletedAt: null },
      },
      select: { id: true, status: true },
    });
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (!['completed', 'approved', 'rejected'].includes(assignment.status)) {
      throw new ConflictError('Only completed, approved, or rejected assignments can be reset');
    }
    const updated = await prisma.taskAssignment.update({
      where: { id: req.params.id },
      data: {
        status: 'pending',
        completedAt: null,
        approvedAt: null,
        approvedBy: null,
        pointsAwarded: null,
        xpAwarded: null,
      },
    });
    res.json({ success: true, data: { assignment: updated } });
  } catch (error) {
    next(error);
  }
});

// GET /tasks/assignments/pending - Get pending approvals (parents only)
taskRouter.get('/assignments/pending', requireParent, async (req, res, next) => {
  try {
    const pendingWhere = {
      status: 'completed' as const,
      task: { familyId: req.familyId, deletedAt: null },
    };
    const { skip, take, page, limit } = toSkipTake(req.query);
    const total = await prisma.taskAssignment.count({ where: pendingWhere });
    const assignments = await prisma.taskAssignment.findMany({
      skip,
      take,
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

    for (const a of assignments) {
      a.evidence = await withEvidenceUrlsList(a.evidence);
    }

    res.json({
      success: true,
      data: { assignments, pagination: buildMeta(total, page, limit) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /tasks/assignments/self-assign - Child self-assigns a secondary task (M5 - CR-10)
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

    // M8 - Audit: child self-assigned a secondary task
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


// ─── Task comments (FR-11) ───────────────────────────────────────────────────
// A short thread between a parent and the assigned child on ONE assignment. Access is limited to
// the participants: family parents/admin, or the child the assignment belongs to. `familyIsolation`
// already pins req.familyId; we additionally re-check the assignment is in that family AND, for a
// child, that it is THEIR assignment — a child must not read another child's thread.

async function loadParticipantAssignment(assignmentId: string, req: any) {
  const assignment = await prisma.taskAssignment.findFirst({
    where: { id: assignmentId, task: { familyId: req.familyId, deletedAt: null } },
    select: { id: true, childId: true, task: { select: { familyId: true } } },
  });
  if (!assignment) throw new NotFoundError('Assignment not found');
  if (req.user.role === 'child' && assignment.childId !== req.user.userId) {
    throw new ForbiddenError('You can only see comments on your own tasks');
  }
  return assignment;
}

// GET /tasks/assignments/:id/comments - list the thread (oldest first).
taskRouter.get('/assignments/:id/comments', async (req, res, next) => {
  try {
    await loadParticipantAssignment(req.params.id, req);
    const comments = await prisma.taskComment.findMany({
      where: { assignmentId: req.params.id },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, firstName: true, lastName: true, role: true } } },
    });
    res.json({ success: true, data: { comments } });
  } catch (error) {
    next(error);
  }
});

const postCommentSchema = z.object({ content: z.string().trim().min(1).max(1000) });

// POST /tasks/assignments/:id/comments - add a comment; broadcasts task:comment to the family.
taskRouter.post(
  '/assignments/:id/comments',
  validateBody(postCommentSchema),
  async (req, res, next) => {
    try {
      const assignment = await loadParticipantAssignment(req.params.id, req);

      const comment = await prisma.taskComment.create({
        data: { assignmentId: req.params.id, authorId: req.user!.userId, content: req.body.content },
        include: { author: { select: { id: true, firstName: true, lastName: true, role: true } } },
      });

      emitTaskComment(req.familyId!, {
        assignmentId: req.params.id,
        comment: {
          id: comment.id,
          authorId: comment.authorId,
          authorName: `${comment.author.firstName} ${comment.author.lastName}`,
          content: comment.content,
          createdAt: comment.createdAt.toISOString(),
        },
      });

      // Notify the OTHER participant (the child if a parent commented; a family parent otherwise).
      if (req.user!.role !== 'child') {
        createNotification({
          userId: assignment.childId,
          notificationType: 'task_comment',
          title: 'New comment on your task',
          message: comment.content.slice(0, 140),
          actionUrl: '/child/tasks',
          referenceType: 'task_assignment',
          referenceId: assignment.id,
        }).catch(() => {});
      }

      res.status(201).json({ success: true, data: { comment } });
    } catch (error) {
      next(error);
    }
  },
);
