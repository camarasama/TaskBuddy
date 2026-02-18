/**
 * gamification.ts — M7: Shared gamification constants (CR-06)
 *
 * Place this file at: backend/src/utils/gamification.ts
 *
 * These constants are the single source of truth for all XP and milestone
 * bonus calculations. Import from here in:
 *  - levelService.ts  (level-up bonus)
 *  - streakService.ts (streak milestone bonus)
 *  - tasks.ts         (task approval XP mapping)
 *
 * IMPORTANT DISTINCTION:
 *  - XP  → progress bar / level advancement. NEVER spent. NEVER decremented.
 *  - Points → currency for redeeming rewards. CAN be spent.
 *  - milestone_bonus → Points-only reward (no XP). Triggered on level-up
 *    and streak milestones.
 */

export const GAMIFICATION_M7 = {
  /**
   * XP awarded per task difficulty on approval.
   * These map to the difficulty field on the Task model.
   */
  TASK_XP: {
    easy:   10,
    medium: 15,
    hard:   35,
  } as const,

  /**
   * Milestone bonus Points multiplier on level-up.
   * Formula: newLevel × LEVEL_MULTIPLIER
   * e.g. Level 1 → 2: bonus = 2 × 5 = 10 Points
   *      Level 2 → 3: bonus = 3 × 5 = 15 Points
   */
  LEVEL_MULTIPLIER: 5,

  /**
   * Bonus Points awarded when a child hits a streak milestone.
   * Keys are the streak day counts that trigger a bonus.
   * Values are the Points awarded (not XP).
   */
  STREAK_MILESTONE_POINTS: {
    7:   35,
    14:  70,
    30:  150,
    60:  300,
    100: 500,
  } as const,
} as const;

/**
 * XP thresholds per level.
 * Level 1 requires 100 XP to advance to Level 2.
 * Each subsequent level requires 50% more XP than the previous.
 *
 * Level 1 → 2:   100 XP
 * Level 2 → 3:   150 XP
 * Level 3 → 4:   225 XP
 * etc.
 *
 * Used by levelService to detect level-up after every XP award.
 */
export function xpRequiredForLevel(level: number): number {
  const BASE_XP = 100;
  const GROWTH_FACTOR = 1.5;
  return Math.floor(BASE_XP * Math.pow(GROWTH_FACTOR, level - 1));
}

/**
 * Calculates what level a child should be at given their total accumulated XP.
 * Returns the new level AND how much XP remains within that level (for the bar).
 *
 * @param totalXpEarned - Lifetime XP (from child_profiles.total_xp_earned)
 * @returns { level, currentLevelXp, xpToNextLevel }
 */
export function calculateLevelFromXp(totalXpEarned: number): {
  level: number;
  currentLevelXp: number;
  xpToNextLevel: number;
} {
  let level = 1;
  let xpRemaining = totalXpEarned;

  while (xpRemaining >= xpRequiredForLevel(level)) {
    xpRemaining -= xpRequiredForLevel(level);
    level++;
  }

  return {
    level,
    currentLevelXp: xpRemaining,
    xpToNextLevel: xpRequiredForLevel(level),
  };
}

/**
 * Streak milestone keys as a typed array for easy iteration in streakService.
 */
export const STREAK_MILESTONE_DAYS = [7, 14, 30, 60, 100] as const;
export type StreakMilestoneDay = (typeof STREAK_MILESTONE_DAYS)[number];
