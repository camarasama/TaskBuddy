/**
 * ChallengeService.ts — daily-challenge generation and completion (FR-08).
 *
 * The DailyChallenge / ChallengeCompletion models and the child-dashboard card have existed since
 * M10, but nothing ever created a challenge row (`dailyChallenge.create` appeared nowhere in the
 * codebase), so the card could never appear in production. This service is the missing generator
 * plus a server-authoritative completion path.
 *
 * Challenge rule (kept deliberately simple, per the agreed scope): "complete N tasks today", where
 * N scales with how many active tasks the family actually has, so a family with two tasks isn't
 * handed an impossible target. One challenge per family per calendar day, enforced by the
 * @@unique([familyId, challengeDate]) constraint — generation is therefore idempotent.
 */

import { prisma } from './database';

const CHALLENGE_TYPE = 'task_count';

/** Midnight (UTC) of the given instant, as a @db.Date-compatible value. */
export function challengeDateFor(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** [startOfDay, endOfDay] in UTC for counting "today"'s completions. */
function dayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const start = challengeDateFor(now);
  const end = new Date(start);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

/** Target task count for a family, given how many active tasks it has. Capped so it's achievable. */
function targetForActiveTasks(activeTaskCount: number): number {
  if (activeTaskCount <= 0) return 0;
  return Math.min(3, activeTaskCount);
}

interface GenerateResult {
  familiesConsidered: number;
  created: number;
  skipped: number; // already had one, or no active tasks
}

/**
 * Create today's challenge for every family that has challenges enabled and enough active tasks to
 * make one meaningful. Idempotent: a second run the same day creates nothing (the unique constraint
 * turns the duplicate insert into a no-op we swallow).
 */
export async function generateDailyChallenges(now: Date = new Date()): Promise<GenerateResult> {
  const challengeDate = challengeDateFor(now);

  const families = await prisma.family.findMany({
    where: { deletedAt: null, settings: { enableDailyChallenges: true } },
    select: { id: true },
  });

  let created = 0;
  let skipped = 0;

  for (const family of families) {
    const activeTaskCount = await prisma.task.count({
      where: { familyId: family.id, deletedAt: null, status: { not: 'archived' } },
    });
    const target = targetForActiveTasks(activeTaskCount);
    if (target === 0) {
      skipped++;
      continue;
    }

    const bonusPoints = target * 10;
    try {
      await prisma.dailyChallenge.create({
        data: {
          familyId: family.id,
          challengeDate,
          title: `Complete ${target} ${target === 1 ? 'task' : 'tasks'} today`,
          description: `Finish ${target} ${target === 1 ? 'task' : 'tasks'} today to earn a ${bonusPoints}-point bonus!`,
          challengeType: CHALLENGE_TYPE,
          criteria: { taskCount: target },
          bonusPoints,
          isActive: true,
        },
      });
      created++;
    } catch (err) {
      // P2002 = unique violation → the challenge for this family+date already exists. That is the
      // idempotency guarantee doing its job, not an error. Anything else is real.
      if ((err as { code?: string })?.code === 'P2002') {
        skipped++;
      } else {
        throw err;
      }
    }
  }

  return { familiesConsidered: families.length, created, skipped };
}

/** How many tasks a child has finished (completed or approved) today. */
export async function tasksCompletedToday(childId: string, now: Date = new Date()): Promise<number> {
  const { start, end } = dayBounds(now);
  return prisma.taskAssignment.count({
    where: {
      childId,
      status: { in: ['completed', 'approved'] },
      // completedAt is set on completion and preserved through approval.
      completedAt: { gte: start, lte: end },
    },
  });
}

export interface ChallengeProgress {
  challenge: {
    id: string;
    title: string;
    description: string | null;
    bonusPoints: number;
    target: number;
  } | null;
  progress: number; // tasks done today, capped at target
  target: number;
  completed: boolean;
}

/** Today's challenge for a child's family, with that child's real progress. Null challenge if none. */
export async function getTodayChallenge(
  familyId: string,
  childId: string,
  now: Date = new Date(),
): Promise<ChallengeProgress> {
  const challenge = await prisma.dailyChallenge.findFirst({
    where: { familyId, challengeDate: challengeDateFor(now), isActive: true },
  });

  if (!challenge) {
    return { challenge: null, progress: 0, target: 0, completed: false };
  }

  const target = (challenge.criteria as { taskCount?: number } | null)?.taskCount ?? 1;
  const completion = await prisma.challengeCompletion.findUnique({
    where: { challengeId_childId: { challengeId: challenge.id, childId } },
  });

  const done = await tasksCompletedToday(childId, now);

  return {
    challenge: {
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      bonusPoints: challenge.bonusPoints,
      target,
    },
    progress: Math.min(done, target),
    target,
    completed: Boolean(completion),
  };
}

export class ChallengeNotMetError extends Error {
  constructor(public readonly done: number, public readonly target: number) {
    super(`Challenge not met yet: ${done}/${target} tasks completed today`);
    this.name = 'ChallengeNotMetError';
  }
}

/**
 * Claim a challenge's bonus. Server-authoritative: it re-counts the child's completed tasks rather
 * than trusting the client, so a child cannot claim a bonus they haven't earned. Idempotent — the
 * @@unique([challengeId, childId]) constraint means a second claim awards nothing.
 *
 * Returns { alreadyClaimed } when the bonus was already granted, so the caller can respond 200
 * without double-paying.
 */
export async function completeChallenge(
  challengeId: string,
  childId: string,
  familyId: string,
  now: Date = new Date(),
): Promise<{ awarded: number; newBalance: number; alreadyClaimed: boolean }> {
  const challenge = await prisma.dailyChallenge.findFirst({
    where: { id: challengeId, familyId, isActive: true },
  });
  if (!challenge) throw new ChallengeNotMetError(0, 0);

  const existing = await prisma.challengeCompletion.findUnique({
    where: { challengeId_childId: { challengeId, childId } },
  });
  if (existing) {
    const profile = await prisma.childProfile.findUnique({
      where: { userId: childId },
      select: { pointsBalance: true },
    });
    return { awarded: 0, newBalance: profile?.pointsBalance ?? 0, alreadyClaimed: true };
  }

  const target = (challenge.criteria as { taskCount?: number } | null)?.taskCount ?? 1;
  const done = await tasksCompletedToday(childId, now);
  if (done < target) throw new ChallengeNotMetError(done, target);

  const bonus = challenge.bonusPoints;

  return prisma.$transaction(async (tx) => {
    const profile = await tx.childProfile.findUnique({
      where: { userId: childId },
      select: { pointsBalance: true },
    });
    const newBalance = (profile?.pointsBalance ?? 0) + bonus;

    // The completion row is what makes this idempotent; the unique constraint will reject a racing
    // second call, so a concurrent double-claim fails rather than double-awarding.
    await tx.challengeCompletion.create({
      data: { challengeId, childId, bonusPointsAwarded: bonus },
    });

    await tx.childProfile.update({
      where: { userId: childId },
      data: { pointsBalance: newBalance },
    });

    await tx.pointsLedger.create({
      data: {
        childId,
        transactionType: 'bonus',
        pointsAmount: bonus,
        balanceAfter: newBalance,
        referenceType: 'daily_challenge',
        referenceId: challengeId,
        description: `🎯 Daily challenge: ${challenge.title}`,
      },
    });

    return { awarded: bonus, newBalance, alreadyClaimed: false };
  });
}
