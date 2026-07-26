/**
 * services/TeamTaskService.ts — team-up tasks (growth roadmap §6).
 *
 * Siblings share one task, and when every one of them has been approved, each receives a teamwork
 * bonus. Four decisions define the behaviour, and three of them are about what this deliberately
 * does *not* do.
 *
 * **Every member earns the full base points; the bonus is on top, never a split.** Dividing the
 * points would make a team task worth less per child than doing it alone, which inverts the whole
 * rationale — children would learn to refuse to team up. §11 also binds that no mechanism may remove
 * a child's earned points.
 *
 * **Approval mechanics are unchanged.** A team task is approved per child exactly as before.
 * Gating approval on every sibling submitting would let one child's inaction hold another child's
 * earned points hostage — the same guardrail, and a guaranteed support complaint.
 *
 * **The bonus pays every member when the LAST one is approved**, including members approved days
 * earlier. Paying only the finisher would reward being last, the same withholding incentive argued
 * against for collaborative rewards in `app-subscription.md`.
 *
 * **The payout is claimed exactly once** via a conditional update on the task row — the FR-09
 * pattern. Two parents approving the final two members at the same moment must not double-pay.
 */

import { prisma } from './database';

export interface TeamMemberState {
  childId: string;
  status: string;
}

export interface TeamProgress {
  total: number;
  approved: number;
  submitted: number;
  /** True when every member's assignment is approved — the bonus condition. */
  complete: boolean;
  /** Members not yet approved. The cooperation signal children actually see. */
  outstanding: string[];
}

/** Statuses that count as "the child has done their part and is waiting on a parent". */
const SUBMITTED_STATUSES = new Set(['completed', 'approved']);

/**
 * Pure summary of where a team stands.
 *
 * A task with fewer than two members is not a team in any meaningful sense; `complete` stays false
 * so a "team" task accidentally assigned to one child never quietly pays a bonus for solo work.
 */
export function teamProgress(members: TeamMemberState[]): TeamProgress {
  const approved = members.filter((m) => m.status === 'approved');
  const submitted = members.filter((m) => SUBMITTED_STATUSES.has(m.status));

  return {
    total: members.length,
    approved: approved.length,
    submitted: submitted.length,
    complete: members.length >= 2 && approved.length === members.length,
    outstanding: members.filter((m) => m.status !== 'approved').map((m) => m.childId),
  };
}

export interface TeamBonusResult {
  awarded: boolean;
  /** Per-child bonus. Every member receives the same amount. */
  pointsEach: number;
  childIds: string[];
}

const NOT_AWARDED: TeamBonusResult = { awarded: false, pointsEach: 0, childIds: [] };

/**
 * Pay the teamwork bonus if this approval completed the team.
 *
 * Called after a successful approval. Returns `{ awarded: false }` for every ordinary task, which is
 * the overwhelmingly common case and costs one already-loaded field to determine.
 *
 * **Never throws into the approval path.** An approval that succeeded must not be reported as failed
 * because the bonus could not be paid; the failure is logged and the base points stand.
 */
export async function awardTeamBonusIfComplete(
  taskId: string,
  parentId: string,
): Promise<TeamBonusResult> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        isTeamTask: true,
        teamBonusPoints: true,
        teamBonusAwardedAt: true,
        assignments: { select: { childId: true, status: true } },
      },
    });

    if (!task || !task.isTeamTask) return NOT_AWARDED;
    if (task.teamBonusPoints <= 0) return NOT_AWARDED;
    if (task.teamBonusAwardedAt) return NOT_AWARDED; // already paid

    const progress = teamProgress(task.assignments);
    if (!progress.complete) return NOT_AWARDED;

    // Claim the payout before touching any balance. If another approval won the race, its
    // updateMany matched the row first and ours matches nothing — so we pay nothing.
    const claim = await prisma.task.updateMany({
      where: { id: taskId, teamBonusAwardedAt: null },
      data: { teamBonusAwardedAt: new Date() },
    });
    if (claim.count === 0) return NOT_AWARDED;

    const bonus = task.teamBonusPoints;
    const childIds = task.assignments.map((a) => a.childId);

    // Sequential rather than parallel: each child's ledger row needs its own balanceAfter, which
    // has to be read and written without another write landing in between.
    for (const childId of childIds) {
      await prisma.$transaction(async (tx) => {
        const profile = await tx.childProfile.findUnique({
          where: { userId: childId },
          select: { pointsBalance: true },
        });
        if (!profile) return;

        const balanceAfter = profile.pointsBalance + bonus;

        await tx.childProfile.update({
          where: { userId: childId },
          data: { pointsBalance: balanceAfter, totalPointsEarned: { increment: bonus } },
        });

        // Through the LEDGER, never a direct balance write — the rule from U8. A balance moved
        // without a matching row makes PointsLedgerReport stop reconciling.
        await tx.pointsLedger.create({
          data: {
            childId,
            transactionType: 'bonus',
            pointsAmount: bonus,
            balanceAfter,
            referenceType: 'team_bonus',
            referenceId: taskId,
            description: `Teamwork bonus: ${task.title}`,
            createdBy: parentId,
          },
        });
      });
    }

    return { awarded: true, pointsEach: bonus, childIds };
  } catch (error) {
    // The approval already succeeded. Losing the bonus is bad; reporting a completed approval as
    // failed is worse.
    console.error('[TeamTaskService] team bonus failed:', (error as Error)?.message);
    return NOT_AWARDED;
  }
}

export const TeamTaskService = { teamProgress, awardTeamBonusIfComplete };
