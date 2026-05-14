// backend/src/routes/taskSelfAssign.ts
// CR-10: POST /tasks/assignments/self-assign
// Allows a child to pick up an available task from the pool.
//
// Guards (all server-side):
//   1. Child must be authenticated.
//   2. The task must belong to the child's family and be active.
//   3. Child must NOT have any pending/in-progress primary assignment.
//   4. [PRIMARY only] Child must NOT have already completed a primary today (daily cap).
//   5. Child must NOT already be at the 3-task active limit.
//   6. Child must NOT already have this task assigned today.

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { NotFoundError, ForbiddenError, ConflictError } from '../middleware/errorHandler';
import { checkAssignmentLimits } from '../utils/assignmentLimits';

export const taskSelfAssignRouter = Router();

taskSelfAssignRouter.use(authenticate, familyIsolation);

const selfAssignSchema = z.object({
  taskId: z.string().uuid('taskId must be a valid UUID'),
});

// POST /tasks/assignments/self-assign
taskSelfAssignRouter.post(
  '/',
  validateBody(selfAssignSchema),
  async (req, res, next) => {
    try {
      // Only children can self-assign
      if (req.user!.role !== 'child') {
        throw new ForbiddenError('Only children can self-assign tasks.');
      }

      const childId = req.user!.userId;
      const { taskId } = req.body as z.infer<typeof selfAssignSchema>;

      // Fetch the task, verifying it's in the child's family
      const task = await prisma.task.findFirst({
        where: {
          id: taskId,
          familyId: req.familyId,
          status: 'active',
          deletedAt: null,
        },
        include: { assignments: { select: { childId: true } } },
      });

      if (!task) {
        throw new NotFoundError('Task not found or is not available.');
      }

      // Guard: claim cap — reject if maxClaimsTotal reached
      if (task.maxClaimsTotal != null) {
        const uniqueClaimers = new Set(task.assignments.map((a) => a.childId)).size;
        if (uniqueClaimers >= task.maxClaimsTotal) {
          throw new ConflictError(
            `This task has reached its maximum of ${task.maxClaimsTotal} claim${task.maxClaimsTotal > 1 ? 's' : ''}.`,
          );
        }
      }

      // Guard 1: child must have no pending/in-progress primary assignments
      const pendingPrimaries = await prisma.taskAssignment.count({
        where: {
          childId,
          status: { in: ['pending', 'in_progress'] },
          task: { taskTag: 'primary' },
        },
      });

      if (pendingPrimaries > 0) {
        throw new ConflictError(
          'You must complete your current primary task before picking up another task.'
        );
      }

      // Guard 2 (primary only): daily cap — one primary self-assign per day
      if (task.taskTag === 'primary') {
        const todayUtc = new Date();
        todayUtc.setUTCHours(0, 0, 0, 0);

        const completedPrimariesToday = await prisma.taskAssignment.count({
          where: {
            childId,
            task: { taskTag: 'primary' },
            status: { in: ['completed', 'approved'] },
            completedAt: { gte: todayUtc },
          },
        });

        if (completedPrimariesToday >= 1) {
          throw new ConflictError(
            'You have already completed a primary task today. Come back tomorrow!'
          );
        }
      }

      // Guard 3: check total active limit
      const limitCheck = await checkAssignmentLimits(childId, task.taskTag as 'primary' | 'secondary');
      if (!limitCheck.allowed) {
        throw new ConflictError(limitCheck.reason!);
      }

      // Guard 4: prevent duplicate assignment for today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const existing = await prisma.taskAssignment.findFirst({
        where: {
          taskId,
          childId,
          instanceDate: today,
          status: { in: ['pending', 'in_progress', 'completed'] },
        },
      });

      if (existing) {
        throw new ConflictError('You have already picked up this task today.');
      }

      // All guards passed — create the assignment
      const assignment = await prisma.taskAssignment.create({
        data: {
          taskId,
          childId,
          instanceDate: today,
        },
        include: {
          task: {
            select: {
              id: true,
              title: true,
              difficulty: true,
              pointsValue: true,
              taskTag: true,
            },
          },
        },
      });

      res.status(201).json({
        success: true,
        data: { assignment },
      });
    } catch (error) {
      next(error);
    }
  }
);
