import { Router } from 'express';
import { prisma } from '../services/database';
import { authenticate, requireParent, requireChild, familyIsolation } from '../middleware/auth';
import { NotFoundError } from '../middleware/errorHandler';
import { isStreakAtRisk } from '../services/streakService';

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
        const [todaysTasks, completedToday, pendingApproval] = await Promise.all([
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

      return {
        tasksCompleted,
        pointsEarned: pointsResult._sum.pointsAmount || 0,
        rewardsRedeemed,
      };
    });

    res.json({
      success: true,
      data: {
        family,
        children: childrenWithStats,
        pendingApprovals,
        weeklyStats,
      },
    });
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

    // Calculate streak info — BUG-06 FIX: atRisk now reads streakGracePeriodHours from FamilySettings
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

    // Get daily challenge (if enabled)
    const dailyChallenge = await prisma.dailyChallenge.findFirst({
      where: {
        familyId: req.familyId,
        challengeDate: today,
        isActive: true,
      },
    });

    let dailyChallengeData = undefined;
    if (dailyChallenge) {
      const completion = await prisma.challengeCompletion.findUnique({
        where: {
          challengeId_childId: {
            challengeId: dailyChallenge.id,
            childId: req.user!.userId,
          },
        },
      });

      // Calculate progress based on challenge type
      // TODO: Implement proper progress calculation
      dailyChallengeData = {
        id: dailyChallenge.id,
        title: dailyChallenge.title,
        description: dailyChallenge.description,
        bonusPoints: dailyChallenge.bonusPoints,
        progress: completion ? 100 : completedToday,
        target: (dailyChallenge.criteria as any)?.taskCount || 3,
        completed: !!completion,
      };
    }

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
        startDate.setDate(startDate.getDate() - startDate.getDay());
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
        // Get points earned in period
        const pointsResult = await prisma.pointsLedger.aggregate({
          where: {
            childId: child.id,
            transactionType: 'earned',
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