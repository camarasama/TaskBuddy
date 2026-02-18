// backend/src/routes/taskSelfAssign.ts
// CR-10: POST /tasks/assignments/self-assign
// Allows a child to pick up an available secondary task from the pool.
//
// Guards (all server-side):
//   1. Child must be authenticated.
//   2. The task must belong to the child's family, be active, and have taskTag = "secondary".
//   3. Child must NOT have any pending primary assignment (primaries must be done first).
//   4. Child must NOT already be at the 3-task active limit.
//   5. Child must NOT already have this task assigned.

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
      });

      if (!task) {
        throw new NotFoundError('Task not found or is not available.');
      }

      // Guard 1: only secondary tasks are self-assignable
      if (task.taskTag !== 'secondary') {
        throw new ForbiddenError(
          'Only secondary (bonus) tasks can be self-assigned. Primary tasks are assigned by a parent.'
        );
      }

      // Guard 2: child must have no pending primary assignments
      const pendingPrimaries = await prisma.taskAssignment.count({
        where: {
          childId,
          status: { in: ['pending', 'in_progress'] },
          task: { taskTag: 'primary' },
        },
      });

      if (pendingPrimaries > 0) {
        throw new ConflictError(
          'You must complete your main tasks before picking up a bonus task.'
        );
      }

      // Guard 3: check total active limit (max 3)
      const limitCheck = await checkAssignmentLimits(childId, 'secondary');
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
