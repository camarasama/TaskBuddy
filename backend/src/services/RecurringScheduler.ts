/**
 * services/RecurringScheduler.ts — M8
 *
 * Midnight cron job that automatically generates TaskAssignment records for
 * all active recurring tasks. This is the fix for BUG-03 (recurring tasks
 * not auto-generating).
 *
 * Behaviour:
 *  1. Runs every day at 00:05 (5 minutes past midnight) to let the previous
 *     day's DB writes settle.
 *  2. Queries every Task where isRecurring = true and status = 'active'.
 *  3. For each recurring task, resolves which children are assigned via the
 *     most recent TaskAssignment for that task.
 *  4. Skips children who already have an assignment for tomorrow's date
 *     (idempotent — safe to run more than once if the cron fires twice).
 *  5. Checks CR-10 assignment limits (max 3 active, max 1 primary per child).
 *     If a child is at the cap, the assignment is SKIPPED and a parent
 *     notification is queued so parents know the task was not auto-generated.
 *  6. Creates the assignment with instanceDate = tomorrow.
 *  7. Writes an AuditService.logSystem() entry for every assignment created
 *     or skipped.
 *
 * The scheduler is registered in backend/src/index.ts via initRecurringScheduler().
 */

import cron from 'node-cron';
import { prisma } from './database';
import { checkAssignmentLimits } from '../utils/assignmentLimits';
import { AuditService } from './AuditService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns midnight (00:00:00.000) of tomorrow in local server time.
 * We store instanceDate as @db.Date so only the date portion matters.
 */
function getTomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Core logic (exported so it can be called manually / in tests) ─────────

/**
 * generateRecurringAssignments()
 *
 * Main function executed by the cron and also callable directly for testing
 * or manual back-fills. Returns a summary of what was created / skipped.
 */
export async function generateRecurringAssignments(): Promise<{
  created: number;
  skipped: number;
  errors: number;
}> {
  const tomorrow = getTomorrow();
  let created = 0;
  let skipped = 0;
  let errors = 0;

  console.log(`[RecurringScheduler] Running for date: ${tomorrow.toISOString().split('T')[0]}`);

  try {
    // 1. Fetch all active recurring tasks with their current assignments.
    //    We include the most recent assignment per task to identify which
    //    children were last assigned (recurring tasks may not have a static
    //    assignedTo list — they replicate the previous assignment).
    const recurringTasks = await prisma.task.findMany({
      where: {
        isRecurring: true,
        status: 'active',
        deletedAt: null,
      },
      include: {
        // Fetch all assignments for this task to determine active children
        assignments: {
          where: {
            status: { in: ['pending', 'in_progress', 'completed', 'approved'] },
          },
          orderBy: { instanceDate: 'desc' },
          // We only need to know which childIds have been assigned to this task
          select: {
            childId: true,
            instanceDate: true,
            status: true,
          },
        },
      },
    });

    console.log(`[RecurringScheduler] Found ${recurringTasks.length} active recurring tasks`);

    for (const task of recurringTasks) {
      // 2. Resolve the unique set of children currently assigned to this task.
      //    We use the most recently seen childId set — deduplicated.
      const uniqueChildIds = [...new Set(task.assignments.map((a) => a.childId))];

      if (uniqueChildIds.length === 0) {
        // No children assigned yet — nothing to auto-generate
        continue;
      }

      for (const childId of uniqueChildIds) {
        try {
          // 3. Idempotency check: skip if assignment already exists for tomorrow
          const existingAssignment = await prisma.taskAssignment.findUnique({
            where: {
              taskId_childId_instanceDate: {
                taskId: task.id,
                childId,
                instanceDate: tomorrow,
              },
            },
          });

          if (existingAssignment) {
            // Already generated — do not duplicate
            continue;
          }

          // 4. CR-10: Check assignment limits before creating
          const limitCheck = await checkAssignmentLimits(childId, task.taskTag);

          if (!limitCheck.allowed) {
            // Cap reached — queue a parent notification and skip
            skipped++;

            console.warn(
              `[RecurringScheduler] Skipping task "${task.title}" for child ${childId}: ${limitCheck.reason}`
            );

            // Fetch the child's familyId to scope the notification
            const child = await prisma.user.findUnique({
              where: { id: childId },
              select: {
                firstName: true,
                lastName: true,
                familyId: true,
                family: {
                  select: {
                    users: {
                      where: { role: 'parent', deletedAt: null, isActive: true },
                      select: { id: true },
                    },
                  },
                },
              },
            });

            if (child) {
              // Notify all parents in the family
              await prisma.notification.createMany({
                data: child.family.users.map((parent) => ({
                  userId: parent.id,
                  notificationType: 'task_limit_reached',
                  title: 'Recurring task skipped',
                  message: `"${task.title}" was not auto-assigned to ${child.firstName} ${child.lastName} because they already have the maximum number of active tasks.`,
                  referenceType: 'task',
                  referenceId: task.id,
                })),
              });
            }

            // Audit: record the skip
            await AuditService.logSystem({
              action: 'SKIP',
              resourceType: 'task_assignment',
              resourceId: task.id,
              familyId: task.familyId,
              metadata: {
                reason: 'assignment_limit_reached',
                childId,
                taskTitle: task.title,
                taskTag: task.taskTag,
                date: tomorrow.toISOString().split('T')[0],
              },
            });

            continue;
          }

          // 5. Create the assignment for tomorrow
          const assignment = await prisma.taskAssignment.create({
            data: {
              taskId: task.id,
              childId,
              instanceDate: tomorrow,
              status: 'pending',
            },
          });

          created++;

          // Audit: record the auto-generated assignment
          await AuditService.logSystem({
            action: 'CREATE',
            resourceType: 'task_assignment',
            resourceId: assignment.id,
            familyId: task.familyId,
            metadata: {
              reason: 'recurring_scheduler',
              taskId: task.id,
              taskTitle: task.title,
              taskTag: task.taskTag,
              childId,
              date: tomorrow.toISOString().split('T')[0],
            },
          });
        } catch (childErr) {
          errors++;
          console.error(
            `[RecurringScheduler] Error processing child ${childId} for task ${task.id}:`,
            childErr
          );
        }
      }
    }
  } catch (err) {
    errors++;
    console.error('[RecurringScheduler] Fatal error during job run:', err);
  }

  console.log(
    `[RecurringScheduler] Done. Created: ${created}, Skipped: ${skipped}, Errors: ${errors}`
  );

  return { created, skipped, errors };
}

// ─── Scheduler registration ───────────────────────────────────────────────────

/**
 * initRecurringScheduler()
 *
 * Registers the node-cron job. Call this once from backend/src/index.ts at
 * server startup alongside initScheduler().
 *
 * Schedule: "5 0 * * *" = 00:05 every day (server local time).
 *
 * The cron expression can be overridden via the RECURRING_CRON_SCHEDULE
 * environment variable. This is useful for tests (e.g. "* * * * *" to run
 * every minute) or to align with a specific timezone.
 */
export function initRecurringScheduler(): void {
  const schedule = process.env.RECURRING_CRON_SCHEDULE || '5 0 * * *';

  if (!cron.validate(schedule)) {
    console.error(`[RecurringScheduler] Invalid cron expression: "${schedule}". Scheduler NOT started.`);
    return;
  }

  cron.schedule(schedule, async () => {
    console.log('[RecurringScheduler] Cron triggered — generating recurring assignments...');
    await generateRecurringAssignments();
  });

  console.log(`[RecurringScheduler] Registered. Schedule: "${schedule}"`);
}
