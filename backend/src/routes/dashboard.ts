import { Router } from 'express';
import { prisma } from '../services/database';
import { authenticate, requireParent, requireChild, familyIsolation } from '../middleware/auth';
import { NotFoundError } from '../middleware/errorHandler';
import { withEvidenceUrlsList } from '../services/storage';
import { GoalService } from '../services/GoalService';
import { CalendarService } from '../services/CalendarService';
import { isStreakAtRisk } from '../services/streakService';
import { getTodayChallenge } from '../services/ChallengeService';

/**
 * Roadmap §5.1 traffic-light: one word for "how is this child doing today".
 *
 * `none` also covers a child with nothing assigned — an empty day is not a red flag, and colouring
 * it as one would train parents to ignore the signal.
 */
function trafficLight(todaysTasks: number, completedToday: number): 'none' | 'in_progress' | 'done' {
  if (todaysTasks === 0) return 'none';
  if (completedToday >= todaysTasks) return 'done';
  return completedToday > 0 ? 'in_progress' : 'none';
}

export const dashboardRouter = Router();

// All dashboard routes require authentication and family isolation
dashboardRouter.use(authenticate, familyIsolation);

// GET /dashboard/parent - Parent dashboard overview
dashboardRouter.get('/parent', requireParent, async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Get family info
    const family = await prisma.family.findUnique({
      where: { id: req.familyId },
    });

    if (!family) {
      throw new NotFoundError('Family not found');
    }

    // Get all active parents in the family (primary + co-parents)
    const parents = await prisma.user.findMany({
      where: {
        familyId: req.familyId,
        role: 'parent',
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        isPrimaryParent: true,
        avatarUrl: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: [{ isPrimaryParent: 'desc' }, { createdAt: 'asc' }],
    });

    // Get children with their stats
    const children = await prisma.user.findMany({
      where: {
        familyId: req.familyId,
        role: 'child',
        deletedAt: null,
      },
      include: {
        childProfile: true,
      },
    });

    // Get stats for each child
    const childrenWithStats = await Promise.all(
      children.map(async (child) => {
        const [todaysTasks, completedToday, pendingApproval, streakAtRisk] = await Promise.all([
          // Today's assigned tasks
          prisma.taskAssignment.count({
            where: {
              childId: child.id,
              instanceDate: today,
              task: { deletedAt: null },
            },
          }),
          // Completed today
          prisma.taskAssignment.count({
            where: {
              childId: child.id,
              instanceDate: today,
              status: { in: ['completed', 'approved'] },
              task: { deletedAt: null },
            },
          }),
          // Pending approval
          prisma.taskAssignment.count({
            where: {
              childId: child.id,
              status: 'completed',
              task: { deletedAt: null },
            },
          }),
          // Roadmap §5.1: the child dashboard has known this since M9; the PARENT — the person who
          // can actually do something about it at dinner — has never been shown it.
          // Promise.resolve so this does not depend on isStreakAtRisk staying async, and a failure
          // degrades to "not at risk" rather than failing the whole dashboard.
          Promise.resolve(isStreakAtRisk(child.id, req.familyId!)).catch(() => false),
        ]);

        const { passwordHash, ...user } = child;
        const profile = child.childProfile
          ? { ...child.childProfile, pinHash: undefined }
          : undefined;

        return {
          user: { ...user, childProfile: profile },
          profile,
          todaysTasks,
          completedToday,
          pendingApproval,
          streakAtRisk,
          // Derived HERE rather than on the client: three counts turned into a status in two places
          // is how two surfaces end up disagreeing about the same child.
          todayStatus: trafficLight(todaysTasks, completedToday),
        };
      })
    );

    // Get pending approvals
    const pendingApprovals = await prisma.taskAssignment.findMany({
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
      take: 10,
    });

    // Evidence is private on R2 since F-4, so the stored fileUrl is empty and must be presigned.
    // The dashboard previously only counted this list; now that it renders thumbnails in the inline
    // approval queue, skipping this step would show broken images.
    for (const assignment of pendingApprovals) {
      assignment.evidence = await withEvidenceUrlsList(assignment.evidence);
    }

    // Get weekly stats
    const weeklyStats = await prisma.$transaction(async (tx) => {
      const tasksCompleted = await tx.taskAssignment.count({
        where: {
          status: 'approved',
          approvedAt: { gte: weekAgo },
          task: {
            familyId: req.familyId,
            deletedAt: null,
          },
        },
      });

      const pointsResult = await tx.pointsLedger.aggregate({
        where: {
          transactionType: 'earned',
          createdAt: { gte: weekAgo },
          child: { familyId: req.familyId },
        },
        _sum: { pointsAmount: true },
      });

      const rewardsRedeemed = await tx.rewardRedemption.count({
        where: {
          createdAt: { gte: weekAgo },
          status: { not: 'cancelled' },
          reward: { familyId: req.familyId },
        },
      });

      // The dashboard has always shown a "Tasks Created" card, but the API never returned the
      // figure and the client hardcoded 0 - so the card read 0 for every family, forever.
      const tasksCreated = await tx.task.count({
        where: {
          familyId: req.familyId,
          deletedAt: null,
          createdAt: { gte: weekAgo },
        },
      });

      // Roadmap §5.1: the week before, so the card can show a direction rather than a bare number.
      // A parent cannot tell whether 12 approvals is good without knowing last week was 4.
      const twoWeeksAgo = new Date(weekAgo);
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 7);

      const tasksCompletedPrevious = await tx.taskAssignment.count({
        where: {
          status: 'approved',
          approvedAt: { gte: twoWeeksAgo, lt: weekAgo },
          task: { familyId: req.familyId, deletedAt: null },
        },
      });

      return {
        tasksCompleted,
        tasksCreated,
        pointsEarned: pointsResult._sum.pointsAmount || 0,
        rewardsRedeemed,
        tasksCompletedPrevious,
        // Null, not 0, when there is no prior week to compare against — "no change" and "no history"
        // are different things and a parent reads them differently.
        tasksCompletedDelta:
          tasksCompletedPrevious === 0 && tasksCompleted === 0
            ? null
            : tasksCompleted - tasksCompletedPrevious,
      };
    });

    // Per-child engagement counts the parent cards surface, so a parent can see a child is waiting
    // on something without opening each profile. Grouped queries, not one per child.
    const childIds = childrenWithStats.map((c) => c.user.id);

    const [wishlistCounts, commentCounts] = await Promise.all([
      childIds.length
        ? prisma.rewardWishlist.groupBy({
            by: ['childId'],
            where: { childId: { in: childIds } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      // Comments a child left that no parent has replied to since - a light "needs a look" signal.
      childIds.length
        ? prisma.taskComment.groupBy({
            by: ['authorId'],
            where: { authorId: { in: childIds }, createdAt: { gte: weekAgo } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    const wishlistByChild = new Map(wishlistCounts.map((r) => [r.childId, r._count._all]));
    const commentsByChild = new Map(commentCounts.map((r) => [r.authorId, r._count._all]));

    // Growth roadmap §4.2: parents see what each child is saving for — oversight, and a gift-idea
    // signal. Fetched per child because progress is derived, not stored.
    const goals = await Promise.all(childIds.map((id) => GoalService.getGoal(id)));
    const goalByChild = new Map(childIds.map((id, i) => [id, goals[i]]));

    const childrenWithEngagement = childrenWithStats.map((c) => ({
      ...c,
      wishlistCount: wishlistByChild.get(c.user.id) ?? 0,
      recentCommentCount: commentsByChild.get(c.user.id) ?? 0,
      goal: goalByChild.get(c.user.id) ?? null,
    }));

    res.json({
      success: true,
      data: {
        family,
        // All active parent accounts (primary + co-parents).
        // totalMembers = parents.length + children.length
        parents,
        children: childrenWithEngagement,
        pendingApprovals,
        weeklyStats,
      },
    });
  } catch (error) {
    next(error);
  }
});


// ─── GET /dashboard/calendar (growth roadmap §5.3) ───────────────────────────
//
// Read-only week view. Lives on the dashboard router because it is family-scoped parent context,
// not an analytical report. Drag-to-reschedule is deliberately NOT here — see CalendarService.
dashboardRouter.get('/calendar', requireParent, async (req, res, next) => {
  try {
    const week = await CalendarService.getWeek({
      familyId: req.familyId!,
      date: req.query.date as string | undefined,
    });
    res.json({ success: true, data: week });
  } catch (error) {
    next(error);
  }
});

// GET /dashboard/child - Child dashboard overview

dashboardRouter.get('/child', requireChild, async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get user and profile
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: {
        childProfile: true,
      },
    });

    if (!user || !user.childProfile) {
      throw new NotFoundError('User not found');
    }

    // Get today's tasks
    const todaysTasks = await prisma.taskAssignment.findMany({
      where: {
        childId: req.user!.userId,
        instanceDate: today,
        task: {
          deletedAt: null,
          status: 'active',
        },
      },
      include: {
        task: true,
        evidence: true,
      },
      orderBy: [
        { status: 'asc' },
        { task: { dueDate: 'asc' } },
      ],
    });

    // Calculate streak info - BUG-06 FIX: atRisk now reads streakGracePeriodHours from FamilySettings
    const completedToday = todaysTasks.filter(
      (a) => a.status === 'completed' || a.status === 'approved'
    ).length;

    const streakAtRisk = await isStreakAtRisk(req.user!.userId, req.familyId!);

    const streak = {
      current: user.childProfile.currentStreakDays,
      atRisk: streakAtRisk,
      completedToday,
      requiredDaily: 1,
    };

    // Get recent achievements
    const recentAchievements = await prisma.childAchievement.findMany({
      where: {
        childId: req.user!.userId,
      },
      include: {
        achievement: true,
      },
      orderBy: { unlockedAt: 'desc' },
      take: 5,
    });

    // Get daily challenge (FR-08): real per-child progress from ChallengeService, replacing the
    // former placeholder that reported the raw completed-today count as "progress".
    const challengeToday = await getTodayChallenge(req.familyId!, req.user!.userId);
    const dailyChallengeData = challengeToday.challenge
      ? {
          id: challengeToday.challenge.id,
          title: challengeToday.challenge.title,
          description: challengeToday.challenge.description,
          bonusPoints: challengeToday.challenge.bonusPoints,
          progress: challengeToday.progress, // tasks done today, capped at target
          target: challengeToday.target,
          completed: challengeToday.completed,
        }
      : undefined;

    // Get next affordable reward
    const nextReward = await prisma.reward.findFirst({
      where: {
        familyId: req.familyId,
        isActive: true,
        deletedAt: null,
        pointsCost: { gt: user.childProfile.pointsBalance },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { pointsCost: 'asc' },
    });

    // Growth roadmap §4.2: the pinned goal, with progress derived live from the points balance.
    const goal = await GoalService.getGoal(req.user!.userId);

    // Remove sensitive data
    const { passwordHash, ...userWithoutPassword } = user;
    const { pinHash, ...profileWithoutPin } = user.childProfile;

    res.json({
      success: true,
      data: {
        user: { ...userWithoutPassword, childProfile: profileWithoutPin },
        profile: profileWithoutPin,
        todaysTasks: todaysTasks.map((a) => ({
          assignment: a,
          task: a.task,
        })),
        streak,
        recentAchievements: recentAchievements.map((ca) => ({
          achievement: ca.achievement,
          unlockedAt: ca.unlockedAt,
        })),
        dailyChallenge: dailyChallengeData,
        nextReward: nextReward
          ? {
              reward: nextReward,
              pointsNeeded: nextReward.pointsCost - user.childProfile.pointsBalance,
            }
          : undefined,
        goal,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /dashboard/points/:childId - Get points history for a child
dashboardRouter.get('/points/:childId', async (req, res, next) => {
  try {
    const { childId } = req.params;

    // Verify access
    if (req.user!.role === 'child' && req.user!.userId !== childId) {
      throw new NotFoundError('Points history not found');
    }

    // Verify child belongs to family
    const child = await prisma.user.findFirst({
      where: {
        id: childId,
        familyId: req.familyId,
        role: 'child',
        deletedAt: null,
      },
      include: { childProfile: true },
    });

    if (!child || !child.childProfile) {
      throw new NotFoundError('Child not found');
    }

    // Get points history
    const entries = await prisma.pointsLedger.findMany({
      where: { childId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({
      success: true,
      data: {
        entries: entries.map((e) => ({
          id: e.id,
          type: e.transactionType,
          amount: e.pointsAmount,
          balanceAfter: e.balanceAfter,
          description: e.description,
          createdAt: e.createdAt,
        })),
        currentBalance: child.childProfile.pointsBalance,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /dashboard/leaderboard - Get family leaderboard
dashboardRouter.get('/leaderboard', async (req, res, next) => {
  try {
    const { period = 'weekly' } = req.query;

    // Check if leaderboard is enabled
    const settings = await prisma.familySettings.findUnique({
      where: { familyId: req.familyId },
    });

    if (!settings?.enableLeaderboard) {
      res.json({
        success: true,
        data: {
          enabled: false,
          entries: [],
        },
      });
      return;
    }

    // Calculate date range
    const now = new Date();
    let startDate = new Date();

    switch (period) {
      case 'daily':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'weekly':
        startDate.setDate(startDate.getDate() - 7); // rolling 7 days
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'monthly':
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      default:
        startDate = new Date(0); // All time
    }

    // Get children with their scores
    const children = await prisma.user.findMany({
      where: {
        familyId: req.familyId,
        role: 'child',
        deletedAt: null,
      },
      include: {
        childProfile: true,
      },
    });

    const entries = await Promise.all(
      children.map(async (child) => {
        // Count all positive-earning transactions in the period
        const pointsResult = await prisma.pointsLedger.aggregate({
          where: {
            childId: child.id,
            transactionType: { in: ['earned', 'game_reward', 'bonus', 'milestone_bonus'] },
            pointsAmount: { gt: 0 },
            createdAt: { gte: startDate },
          },
          _sum: { pointsAmount: true },
        });

        // Get tasks completed in period
        const tasksCompleted = await prisma.taskAssignment.count({
          where: {
            childId: child.id,
            status: 'approved',
            approvedAt: { gte: startDate },
          },
        });

        return {
          childId: child.id,
          childName: child.firstName,
          avatarUrl: child.avatarUrl,
          gender: child.gender ?? null,
          weeklyPoints: pointsResult._sum.pointsAmount || 0,
          weeklyTasks: tasksCompleted,
          currentStreak: child.childProfile?.currentStreakDays || 0,
        };
      })
    );

    // Calculate scores and rank
    const scoredEntries = entries
      .map((e) => ({
        ...e,
        score: e.weeklyPoints + e.weeklyTasks * 5 + e.currentStreak * 2,
      }))
      .sort((a, b) => b.score - a.score)
      .map((e, index) => ({ ...e, rank: index + 1 }));

    res.json({
      success: true,
      data: {
        enabled: true,
        period,
        entries: scoredEntries,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
});