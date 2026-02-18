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
        const profile = childWithProfile.childProfile;

        // M7 — CR-06: Map difficulty to XP using gamification constants
        const difficulty = (assignment.task.difficulty ?? 'medium') as keyof typeof GAMIFICATION_M7.TASK_XP;
        const baseXp = GAMIFICATION_M7.TASK_XP[difficulty] ?? GAMIFICATION_M7.TASK_XP.medium;

        // M7 — CR-06: Points and XP are awarded separately
        const basePoints = assignment.task.pointsValue; // spendable currency
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
              // No approvedBy — system-triggered, not a parent action
              pointsAwarded: basePoints,
              xpAwarded: baseXp,
            },
          });

          // M7 — CR-06: Update both XP fields AND Points separately
          await tx.childProfile.update({
            where: { userId: assignment.childId },
            data: {
              pointsBalance: newPointsBalance,
              totalPointsEarned: { increment: basePoints },
              totalTasksCompleted: { increment: 1 },
              // experiencePoints = XP within current level bar (resets each level)
              experiencePoints: newXp,
              // totalXpEarned = lifetime XP, never decremented (drives level calc)
              totalXpEarned: newTotalXpEarned,
            },
          });

          // M7 — CR-06: Points ledger entry for spendable Points earned
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

        // M7 — CR-06: Check for level-up AFTER the transaction updates totalXpEarned
        const levelUpResult = await checkAndApplyLevelUp(assignment.childId, oldLevel);

        const unlockedAchievements = await checkAndUnlockAchievements(assignment.childId);

        // BUG-06: Update streak using grace period from FamilySettings
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

    res.json({
      success: true,
      data: { assignment: updated },
    });
  } catch (error) {
    next(error);
  }
});

// POST /tasks/assignments/:id/upload - Upload photo evidence for a task
//
// BUG FIX: The original route used req.file.path (disk storage), but multer
// was switched to memoryStorage in M2. With memoryStorage, req.file.path is
// undefined — crashing the route with a 500. The fix is to use StorageService
// (uploadFile) which reads from req.file.buffer and handles both local disk
// and Cloudflare R2 based on the STORAGE_PROVIDER env var.
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

    // With memoryStorage, the file is in req.file.buffer — NOT req.file.path.
    // Build the absolute API base URL so StorageService can construct full
    // accessible URLs (required for ngrok / production deployments).
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const apiBaseUrl = `${protocol}://${host}`;

    const uploadResult = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      apiBaseUrl,
    );

    // Create evidence record with full URLs and thumbnail from StorageService
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
// XP drives level progression and is never spent.
// Points are spendable currency used to redeem rewards.
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

      // M7 — CR-06: Points and XP are completely independent
      const basePoints = assignment.task.pointsValue; // spendable — goes to pointsBalance
      const newPointsBalance = profile.pointsBalance + basePoints;
      const newXp = profile.experiencePoints + baseXp;
      const newTotalXpEarned = profile.totalXpEarned + baseXp;
      const oldLevel = profile.level; // snapshot BEFORE update for level-up detection

      // Award Points and XP in a single atomic transaction
      const result = await prisma.$transaction(async (tx) => {
        // Mark assignment as approved with both awarded values
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

        // M7 — CR-06: Update child profile with both XP fields and Points
        await tx.childProfile.update({
          where: { userId: assignment.childId },
          data: {
            // Spendable currency
            pointsBalance: newPointsBalance,
            totalPointsEarned: { increment: basePoints },
            totalTasksCompleted: { increment: 1 },
            // XP — level bar progress (visual progress within current level)
            experiencePoints: newXp,
            // M7: Lifetime XP accumulator — drives level calculation, never reset
            totalXpEarned: newTotalXpEarned,
          },
        });

        // M7 — CR-06: Ledger entry for the Points awarded (spendable currency)
        // XP is NOT recorded in the ledger — it's tracked on the profile directly.
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
            // Breakdown lets the frontend show the XP earned alongside Points
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

      // M7 — CR-06: Check for level-up AFTER the transaction so totalXpEarned is committed
      // checkAndApplyLevelUp creates a milestone_bonus ledger entry if the child levelled up
      const levelUpResult = await checkAndApplyLevelUp(assignment.childId, oldLevel);

      // Check and unlock any achievements earned
      const unlockedAchievements = await checkAndUnlockAchievements(assignment.childId);

      // BUG-06: Update streak using grace period from FamilySettings
      await evaluateStreak(assignment.childId, req.familyId!);

      res.json({
        success: true,
        data: {
          ...result,
          // M7: levelUp is included so the frontend can show a celebration modal
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

    // Check child has no pending primaries
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

    // Check assignment limits
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

    res.status(201).json({
      success: true,
      data: { assignment },
    });
  } catch (error) {
    next(error);
  }
});