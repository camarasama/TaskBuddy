import { Router } from 'express';
import { prisma } from '../services/database';
import { authenticate, requireChild, familyIsolation } from '../middleware/auth';

export const achievementRouter = Router();

// All routes require authentication and family isolation
achievementRouter.use(authenticate, familyIsolation);

// GET /achievements - Get all achievements with unlock status for current child
achievementRouter.get('/', requireChild, async (req, res, next) => {
  try {
    const childId = req.user!.userId;

    // Get all achievements
    const achievements = await prisma.achievement.findMany({
      orderBy: [
        { category: 'asc' },
        { tier: 'asc' },
        { name: 'asc' },
      ],
    });

    // Get child's unlocked achievements
    const unlockedAchievements = await prisma.childAchievement.findMany({
      where: { childId },
    });

    const unlockedMap = new Map(
      unlockedAchievements.map((ua) => [ua.achievementId, ua])
    );

    // Merge achievements with unlock status
    const result = achievements.map((achievement) => {
      const unlocked = unlockedMap.get(achievement.id);
      return {
        ...achievement,
        unlocked: !!unlocked,
        unlockedAt: unlocked?.unlockedAt || null,
        progressValue: unlocked?.progressValue || null,
      };
    });

    // Summary stats
    const totalAchievements = achievements.length;
    const unlockedCount = unlockedAchievements.length;
    const totalPointsEarned = achievements
      .filter((a) => unlockedMap.has(a.id))
      .reduce((sum, a) => sum + a.pointsReward, 0);
    const totalXpEarned = achievements
      .filter((a) => unlockedMap.has(a.id))
      .reduce((sum, a) => sum + a.xpReward, 0);

    res.json({
      success: true,
      data: {
        achievements: result,
        stats: {
          total: totalAchievements,
          unlocked: unlockedCount,
          totalPointsEarned,
          totalXpEarned,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /achievements/unlocked - Get only unlocked achievements for current child
achievementRouter.get('/unlocked', requireChild, async (req, res, next) => {
  try {
    const childId = req.user!.userId;

    const childAchievements = await prisma.childAchievement.findMany({
      where: { childId },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
    });

    res.json({
      success: true,
      data: {
        achievements: childAchievements.map((ca) => ({
          ...ca.achievement,
          unlockedAt: ca.unlockedAt,
          progressValue: ca.progressValue,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});
