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
import { GAMIFICATION, difficultyFromPoints } from '@taskbuddy/shared';
import { uploadPhoto } from '../middleware/upload';
// M5 — CR-09 / CR-10 utilities
import { checkAssignmentLimits } from '../utils/assignmentLimits';
import { getTaskOverlaps } from '../utils/overlapCheck';
// BUG FIX: Use StorageService (memoryStorage buffer) instead of old disk-path approach
import { uploadFile } from '../services/storage';
// M8 — Audit logging for all mutating task routes
import { AuditService } from '../services/AuditService';
// P4 — Business logic delegated to TaskService
import { TaskService } from '../services/TaskService';
import { createNotification } from './notifications';

export const taskRouter = Router();

// All task routes require authentication and family isolation
taskRouter.use(authenticate, familyIsolation);

// Validation schemas
const createTaskSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(1000).optional(),
  category: z.string().max(50).optional(),
  // difficulty derived server-side from pointsValue via difficultyFromPoints()
  // M5 — CR-01: primary/secondary tag (defaults to primary)
  taskTag: z.enum(['primary', 'secondary']).optional().default('primary'),
  pointsValue: z.number().int().min(5).max(1000),
  dueDate: z.string().datetime().refine(
    (v) => new Date(v) > new Date(),
    { message: 'Due date must be in the future' }
  ),
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

    // Children need to see:
    // 1. Tasks assigned to them (primary or secondary)
    // 2. Unassigned secondary tasks available to self-assign
    // 3. Unassigned primary tasks available to self-assign (one per day)
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
          assignments: { none: {} },
        },
        {
          taskTag: 'primary',
          assignments: { none: {} },
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
      throw new ConflictError(`Task is already ${assignment.status} — cannot start again`);
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