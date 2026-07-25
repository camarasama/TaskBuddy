/**
 * scripts/backfill-recurring.ts
 *
 * One-time backfill that corrects existing data for recurring tasks:
 *
 *  1. Restore any recurring tasks that were incorrectly archived.
 *     (The hourly expiry cron used to archive recurring tasks past their due
 *      date when they had no assignments — now guarded by isRecurring: false.)
 *
 *  2. Advance the dueDate on every active recurring task whose dueDate is
 *     null or in the past — sets it to 23:59:59 of tomorrow so the expiry
 *     cron and child task cards show a current deadline.
 *
 *  3. Create today's assignment for any child who has a prior assignment on a
 *     recurring task but no active assignment for today.  Covers children
 *     whose assignments were deleted (instead of expired) by the old scheduler.
 *
 * Run once, from any directory:
 *   npm run backfill:recurring
 */

// Same cwd trap as backfill-game-banks: `import 'dotenv/config'` resolves .env from the WORKING
// DIRECTORY, so this only ever worked when run from backend/. config/index.ts resolves it from
// __dirname instead. Left unfixed this fails with an unset DATABASE_URL, not a clear error.
import '../config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function banner(msg: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(msg);
  console.log('─'.repeat(60));
}

async function main() {
  const now = new Date();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(23, 59, 59, 999);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  console.log('Recurring Task Backfill');
  console.log(`Now      : ${now.toISOString()}`);
  console.log(`Today    : ${today.toISOString()}`);
  console.log(`Tomorrow : ${tomorrow.toISOString()}`);

  // ── Step 1: Restore incorrectly archived recurring tasks ─────────────────

  banner('Step 1 — Restore archived recurring tasks');

  const archivedRecurring = await prisma.task.findMany({
    where: { isRecurring: true, status: 'archived', deletedAt: null },
    select: { id: true, title: true, familyId: true, dueDate: true },
  });

  if (archivedRecurring.length === 0) {
    console.log('None found — nothing to restore.');
  } else {
    console.log(`Found ${archivedRecurring.length} archived recurring task(s):`);
    for (const t of archivedRecurring) {
      console.log(`  • "${t.title}" (${t.id})  dueDate=${t.dueDate?.toISOString() ?? 'null'}`);
    }

    const { count } = await prisma.task.updateMany({
      where: { isRecurring: true, status: 'archived', deletedAt: null },
      data: { status: 'active' },
    });
    console.log(`✓ Restored ${count} task(s) → status: active`);
  }

  // ── Step 2: Advance stale due dates ──────────────────────────────────────

  banner('Step 2 — Advance stale / missing due dates');

  const stale = await prisma.task.findMany({
    where: {
      isRecurring: true,
      status: 'active',
      deletedAt: null,
      OR: [{ dueDate: null }, { dueDate: { lt: now } }],
    },
    select: { id: true, title: true, dueDate: true },
  });

  if (stale.length === 0) {
    console.log('None found — all due dates are current.');
  } else {
    console.log(`Found ${stale.length} task(s) with stale/missing due dates:`);
    for (const t of stale) {
      console.log(
        `  • "${t.title}" (${t.id})  ${t.dueDate?.toISOString() ?? 'null'} → ${tomorrow.toISOString()}`
      );
    }

    const { count } = await prisma.task.updateMany({
      where: {
        isRecurring: true,
        status: 'active',
        deletedAt: null,
        OR: [{ dueDate: null }, { dueDate: { lt: now } }],
      },
      data: { dueDate: tomorrow },
    });
    console.log(`✓ Advanced due dates for ${count} task(s) → ${tomorrow.toISOString()}`);
  }

  // ── Step 3: Create today's missing assignments ────────────────────────────

  banner("Step 3 — Create today's missing assignments");

  const recurringTasks = await prisma.task.findMany({
    where: { isRecurring: true, status: 'active', deletedAt: null },
    include: {
      assignments: {
        select: { childId: true, instanceDate: true, status: true },
      },
    },
  });

  let created = 0;
  let skipped = 0;
  let failed  = 0;

  for (const task of recurringTasks) {
    // Collect all childIds who have ever been assigned to this task
    const uniqueChildIds = [...new Set(task.assignments.map((a) => a.childId))];

    if (uniqueChildIds.length === 0) continue;

    for (const childId of uniqueChildIds) {
      // Skip if any assignment (any status) already exists for today — unique constraint
      const todayAssignment = await prisma.taskAssignment.findUnique({
        where: {
          taskId_childId_instanceDate: {
            taskId: task.id,
            childId,
            instanceDate: today,
          },
        },
      });

      if (todayAssignment) {
        skipped++;
        continue;
      }

      // Create a fresh pending assignment for today
      try {
        await prisma.taskAssignment.create({
          data: { taskId: task.id, childId, instanceDate: today, status: 'pending' },
        });
        created++;
        console.log(`  ✓ Created  task="${task.title}"  child=${childId}`);
      } catch (err) {
        failed++;
        console.error(`  ✗ Failed   task="${task.title}"  child=${childId}`, err);
      }
    }
  }

  console.log(`\nAssignments: created=${created}  already-existed=${skipped}  failed=${failed}`);

  banner('Backfill complete');
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
