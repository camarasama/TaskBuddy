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
      
      // Show tasks that are either:
      // - Assigned to this child, OR
      // - Secondary tasks with NO assignments (available pool)
      where.OR = [
        // Tasks assigned to me
        {
          assignments: {
            some: { childId: targetChildId },
          },
        },
        // Unassigned secondary tasks (available bonus pool)
        {
          taskTag: 'secondary',
          assignments: {
            none: {}, // No assignments at all = available
          },
        },
      ];
    } else if (childId) {
      // Parent filtering by specific child
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
        // Task is self-assignable if:
        // 1. It's secondary
        // 2. Child has no pending primaries
        // 3. Task is not already assigned to this child
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

      // Create assignments for each child (only if children are assigned)
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

    // HTTP 201 — include warnings[] so the frontend can show the overlap modal
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
      // Use the incoming value if provided, otherwise fall back to what's stored
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
          task.id   // exclude this task from its own overlap check
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

// GET /tasks/assignments - Get assignments for current user
taskRouter.get('/assignments/me', async (req, res, next) => {
  try {
    const where: any = {};

    // Children can only see their own assignments
    if (req.user!.role === 'child') {
      where.childId = req.user!.userId;
    } else {
      // Parents can filter by child
      const { childId, status } = req.query;
      if (childId) where.childId = childId;
      if (status) where.status = status;
    }

    // Filter by family through task relation
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
      include: { task: true },
    });

    if (!assignment) {
      throw new NotFoundError('Assignment not found');
    }

    // Check if user can complete this assignment
    if (req.user!.role === 'child' && assignment.childId !== req.user!.userId) {
      throw new ForbiddenError('Cannot complete another child\'s task');
    }

    if (assignment.status !== 'pending' && assignment.status !== 'in_progress') {
      throw new ConflictError('Task is already completed or processed');
    }

    // Update assignment
    const updated = await prisma.taskAssignment.update({
      where: { id: req.params.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
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
        const basePoints = assignment.task.pointsValue;
        const difficulty = assignment.task.difficulty || 'medium';
        const baseXp = GAMIFICATION.TASK_XP[difficulty as keyof typeof GAMIFICATION.TASK_XP] || 15;
        const profile = childWithProfile.childProfile;
        const newBalance = profile.pointsBalance + basePoints;
        const newXp = profile.experiencePoints + baseXp;

        const autoApproveResult = await prisma.$transaction(async (tx) => {
          const approvedAssignment = await tx.taskAssignment.update({
            where: { id: req.params.id },
            data: {
              status: 'approved',
              approvedAt: new Date(),
              // No approvedBy — system-triggered, not a parent action
              pointsAwarded: basePoints,
              xpAwarded: baseXp,
            },
          });

          await tx.childProfile.update({
            where: { userId: assignment.childId },
            data: {
              pointsBalance: newBalance,
              totalPointsEarned: { increment: basePoints },
              totalTasksCompleted: { increment: 1 },
              experiencePoints: newXp,
            },
          });

          await tx.pointsLedger.create({
            data: {
              childId: assignment.childId,
              transactionType: 'earned',
              pointsAmount: basePoints,
              balanceAfter: newBalance,
              referenceType: 'task_completion',
              referenceId: assignment.id,
              description: `Auto-approved: ${assignment.task.title}`,
            },
          });

          return { assignment: approvedAssignment, pointsAwarded: basePoints, xpAwarded: baseXp, newBalance };
        });

        const unlockedAchievements = await checkAndUnlockAchievements(assignment.childId);

        // BUG-06: Update streak using grace period from FamilySettings
        await evaluateStreak(assignment.childId, req.familyId!);

        res.json({
          success: true,
          data: { ...autoApproveResult, autoApproved: true, unlockedAchievements },
        });
        return;
      }
    }

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

    // Build URL path relative to server
    const relativePath = req.file.path.split('/uploads/').pop();
    const fileUrl = `/uploads/${relativePath}`;

    // Create evidence record
    const evidence = await prisma.taskEvidence.create({
      data: {
        assignmentId: assignment.id,
        evidenceType: 'photo',
        fileUrl,
        fileKey: req.file.filename,
        fileSizeBytes: req.file.size,
        mimeType: req.file.mimetype,
      },
    });

    res.json({
      success: true,
      data: {
        evidence: {
          id: evidence.id,
          fileUrl,
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
      // Calculate points and XP
      const basePoints = assignment.task.pointsValue;
      const difficulty = assignment.task.difficulty || 'medium';
      const baseXp = GAMIFICATION.TASK_XP[difficulty as keyof typeof GAMIFICATION.TASK_XP] || 15;

      // TODO: Calculate streak bonus, early completion bonus

      // Update assignment and award points in transaction
      const result = await prisma.$transaction(async (tx) => {
        // Update assignment
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

        // Get current balance
        const profile = assignment.child.childProfile!;
        const newBalance = profile.pointsBalance + basePoints;
        const newXp = profile.experiencePoints + baseXp;

        // Update child profile
        await tx.childProfile.update({
          where: { userId: assignment.childId },
          data: {
            pointsBalance: newBalance,
            totalPointsEarned: { increment: basePoints },
            totalTasksCompleted: { increment: 1 },
            experiencePoints: newXp,
          },
        });

        // Create points ledger entry
        await tx.pointsLedger.create({
          data: {
            childId: assignment.childId,
            transactionType: 'earned',
            pointsAmount: basePoints,
            balanceAfter: newBalance,
            referenceType: 'task_completion',
            referenceId: assignment.id,
            description: `Completed: ${assignment.task.title}`,
            createdBy: req.user!.userId,
          },
        });

        return {
          assignment: updatedAssignment,
          pointsAwarded: basePoints,
          xpAwarded: baseXp,
          newBalance,
        };
      });

      // Check and unlock any achievements earned
      const unlockedAchievements = await checkAndUnlockAchievements(assignment.childId);

      // BUG-06: Update streak using grace period from FamilySettings
      await evaluateStreak(assignment.childId, req.familyId!);

      res.json({
        success: true,
        data: {
          ...result,
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