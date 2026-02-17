import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const achievements = [
  // Tasks category
  {
    name: 'First Step',
    description: 'Complete your very first task',
    category: 'tasks',
    unlockCriteriaType: 'tasks_completed',
    unlockCriteriaValue: 1,
    tier: 'bronze',
    pointsReward: 10,
    xpReward: 25,
  },
  {
    name: 'Getting Started',
    description: 'Complete 5 tasks',
    category: 'tasks',
    unlockCriteriaType: 'tasks_completed',
    unlockCriteriaValue: 5,
    tier: 'bronze',
    pointsReward: 25,
    xpReward: 50,
  },
  {
    name: 'Task Master',
    description: 'Complete 25 tasks',
    category: 'tasks',
    unlockCriteriaType: 'tasks_completed',
    unlockCriteriaValue: 25,
    tier: 'silver',
    pointsReward: 50,
    xpReward: 100,
  },
  {
    name: 'Unstoppable',
    description: 'Complete 100 tasks',
    category: 'tasks',
    unlockCriteriaType: 'tasks_completed',
    unlockCriteriaValue: 100,
    tier: 'gold',
    pointsReward: 150,
    xpReward: 300,
  },
  {
    name: 'Legendary Helper',
    description: 'Complete 500 tasks',
    category: 'tasks',
    unlockCriteriaType: 'tasks_completed',
    unlockCriteriaValue: 500,
    tier: 'platinum',
    pointsReward: 500,
    xpReward: 1000,
  },

  // Streaks category
  {
    name: 'Consistent',
    description: 'Maintain a 3-day streak',
    category: 'streaks',
    unlockCriteriaType: 'streak_days',
    unlockCriteriaValue: 3,
    tier: 'bronze',
    pointsReward: 15,
    xpReward: 30,
  },
  {
    name: 'On a Roll',
    description: 'Maintain a 7-day streak',
    category: 'streaks',
    unlockCriteriaType: 'streak_days',
    unlockCriteriaValue: 7,
    tier: 'silver',
    pointsReward: 50,
    xpReward: 100,
  },
  {
    name: 'Dedicated',
    description: 'Maintain a 14-day streak',
    category: 'streaks',
    unlockCriteriaType: 'streak_days',
    unlockCriteriaValue: 14,
    tier: 'gold',
    pointsReward: 100,
    xpReward: 200,
  },
  {
    name: 'Ironclad',
    description: 'Maintain a 30-day streak',
    category: 'streaks',
    unlockCriteriaType: 'streak_days',
    unlockCriteriaValue: 30,
    tier: 'platinum',
    pointsReward: 300,
    xpReward: 600,
  },

  // Points category
  {
    name: 'Saver',
    description: 'Earn 100 total points',
    category: 'points',
    unlockCriteriaType: 'points_earned',
    unlockCriteriaValue: 100,
    tier: 'bronze',
    pointsReward: 10,
    xpReward: 20,
  },
  {
    name: 'Treasure Hunter',
    description: 'Earn 500 total points',
    category: 'points',
    unlockCriteriaType: 'points_earned',
    unlockCriteriaValue: 500,
    tier: 'silver',
    pointsReward: 50,
    xpReward: 100,
  },
  {
    name: 'Rich Kid',
    description: 'Earn 2,000 total points',
    category: 'points',
    unlockCriteriaType: 'points_earned',
    unlockCriteriaValue: 2000,
    tier: 'gold',
    pointsReward: 100,
    xpReward: 250,
  },

  // Milestones category
  {
    name: 'Level Up!',
    description: 'Reach Level 5',
    category: 'milestones',
    unlockCriteriaType: 'level_reached',
    unlockCriteriaValue: 5,
    tier: 'bronze',
    pointsReward: 25,
    xpReward: 50,
  },
  {
    name: 'Rising Star',
    description: 'Reach Level 10',
    category: 'milestones',
    unlockCriteriaType: 'level_reached',
    unlockCriteriaValue: 10,
    tier: 'silver',
    pointsReward: 75,
    xpReward: 150,
  },
  {
    name: 'Champion',
    description: 'Reach Level 25',
    category: 'milestones',
    unlockCriteriaType: 'level_reached',
    unlockCriteriaValue: 25,
    tier: 'gold',
    pointsReward: 200,
    xpReward: 500,
  },
  {
    name: 'First Reward',
    description: 'Redeem your first reward',
    category: 'milestones',
    unlockCriteriaType: 'rewards_redeemed',
    unlockCriteriaValue: 1,
    tier: 'bronze',
    pointsReward: 15,
    xpReward: 30,
  },

  // Special category
  {
    name: 'Early Bird',
    description: 'Complete a task before 9 AM',
    category: 'special',
    unlockCriteriaType: 'early_completion',
    unlockCriteriaValue: 1,
    tier: 'silver',
    pointsReward: 30,
    xpReward: 60,
  },
  {
    name: 'Perfect Week',
    description: 'Complete all assigned tasks in a week',
    category: 'special',
    unlockCriteriaType: 'perfect_week',
    unlockCriteriaValue: 1,
    tier: 'gold',
    pointsReward: 100,
    xpReward: 200,
  },
];

async function main() {
  console.log('Seeding achievements...');

  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: {
        id: achievement.name, // This won't match, so we use a different strategy
      },
      update: {
        description: achievement.description,
        category: achievement.category,
        unlockCriteriaType: achievement.unlockCriteriaType,
        unlockCriteriaValue: achievement.unlockCriteriaValue,
        tier: achievement.tier,
        pointsReward: achievement.pointsReward,
        xpReward: achievement.xpReward,
      },
      create: {
        name: achievement.name,
        description: achievement.description,
        category: achievement.category,
        unlockCriteriaType: achievement.unlockCriteriaType,
        unlockCriteriaValue: achievement.unlockCriteriaValue,
        tier: achievement.tier,
        pointsReward: achievement.pointsReward,
        xpReward: achievement.xpReward,
        isSystemAchievement: true,
      },
    }).catch(async () => {
      // If upsert fails (no unique constraint on name), try create or skip
      const existing = await prisma.achievement.findFirst({
        where: { name: achievement.name },
      });
      if (!existing) {
        await prisma.achievement.create({
          data: {
            name: achievement.name,
            description: achievement.description,
            category: achievement.category,
            unlockCriteriaType: achievement.unlockCriteriaType,
            unlockCriteriaValue: achievement.unlockCriteriaValue,
            tier: achievement.tier,
            pointsReward: achievement.pointsReward,
            xpReward: achievement.xpReward,
            isSystemAchievement: true,
          },
        });
        console.log(`  Created: ${achievement.name}`);
      } else {
        await prisma.achievement.update({
          where: { id: existing.id },
          data: {
            description: achievement.description,
            category: achievement.category,
            unlockCriteriaType: achievement.unlockCriteriaType,
            unlockCriteriaValue: achievement.unlockCriteriaValue,
            tier: achievement.tier,
            pointsReward: achievement.pointsReward,
            xpReward: achievement.xpReward,
          },
        });
        console.log(`  Updated: ${achievement.name}`);
      }
    });
  }

  const count = await prisma.achievement.count();
  console.log(`\nDone! ${count} achievements in database.`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
