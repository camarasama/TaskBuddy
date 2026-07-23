import { Router } from 'express';
import { prisma } from '../services/database';
import { toSkipTake, buildMeta, MAX_LIMIT } from '../utils/pagination';
import { authenticate, requireChild, familyIsolation } from '../middleware/auth';

export const achievementRouter = Router();

// All routes require authentication and family isolation
achievementRouter.use(authenticate, familyIsolation);

// GET /achievements - Get all achievements with unlock status for current child
achievementRouter.get('/', requireChild, async (req, res, next) => {
  try {
    const childId = req.user!.userId;

    // FR-07: paginated, but the DEFAULT limit is MAX_LIMIT rather than the usual 20. This is a
    // fixed, seeded catalog (18 rows today) rendered as one grid — defaulting to 20 would silently
    // truncate a child's achievements the moment a 21st is seeded. Callers can still page
    // explicitly. The stats below are counted over the WHOLE catalog, never the page.
    const { skip, take, page, limit } = toSkipTake({ limit: MAX_LIMIT, ...req.query });
    const total = await prisma.achievement.count();
    const achievements = await prisma.achievement.findMany({
      skip,
      take,
      orderBy: [
        { category: 'asc' },
        { tier: 'asc' },
        { name: 'asc' },
      ],
    });

    // Get child's unlocked achievements. Includes the achievement record so the reward totals
    // below are computed over EVERY unlocked achievement, independent of which page was requested.
    const unlockedAchievements = await prisma.childAchievement.findMany({
      where: { childId },
      include: { achievement: { select: { pointsReward: true, xpReward: true } } },
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

    // Summary stats — whole-catalog, never the current page (FR-07).
    const totalAchievements = total;
    const unlockedCount = unlockedAchievements.length;
    const totalPointsEarned = unlockedAchievements.reduce(
      (sum, ua) => sum + (ua.achievement?.pointsReward ?? 0),
      0,
    );
    const totalXpEarned = unlockedAchievements.reduce(
      (sum, ua) => sum + (ua.achievement?.xpReward ?? 0),
      0,
    );

    res.json({
      success: true,
      data: {
        achievements: result,
        pagination: buildMeta(total, page, limit),
        stats: {
          // Counted over the whole catalog, not the current page.
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
