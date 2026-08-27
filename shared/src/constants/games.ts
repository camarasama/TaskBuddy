// Games taxonomy and economy (games redesign, 2026-07-30).
//
// A child picks a CATEGORY and a LEVEL, then plays. Both axes live here rather than being implied by a
// game's title, which is how the previous design encoded them.

/** Subject axis. `puzzle` is a category (logic/pattern questions), not a game format. */
export const GAME_CATEGORIES = [
  'maths',
  'science',
  'geography',
  'vocabulary',
  'grammar',
  'puzzle',
] as const;

export type GameCategory = (typeof GAME_CATEGORIES)[number];

/** Difficulty axis, freely selectable at any age — appropriateness lives in the authored content. */
export const GAME_LEVELS = ['beginner', 'intermediate', 'hard'] as const;

export type GameLevel = (typeof GAME_LEVELS)[number];

export const GAME_CATEGORY_LABELS: Record<GameCategory, string> = {
  maths: 'Maths',
  science: 'Science',
  geography: 'Geography',
  vocabulary: 'Vocabulary',
  grammar: 'Grammar',
  puzzle: 'Puzzles',
};

export const GAME_LEVEL_LABELS: Record<GameLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  hard: 'Hard',
};

/**
 * Short forms, for a control too narrow to hold the full name.
 *
 * The mobile picker draws the three levels as columns on a phone. "Intermediate" does not fit that
 * box on a 320dp screen even shrunk to the minimum font scale, and a clipped word is worse than a
 * short one. These are used **only** where the width is fixed and small; the full labels above stay
 * everywhere with room to render them, including every accessibility label, so a screen reader still
 * says "Intermediate" where the eye sees "Medium".
 *
 * Easy/Medium/Hard rather than Beginner/Medium/Hard: the three have to read as one scale, and a
 * mixed register ("Beginner" beside "Medium") reads as two different questions. This triple is also
 * the one a child already knows from every other game they have played.
 */
export const GAME_LEVEL_SHORT_LABELS: Record<GameLevel, string> = {
  beginner: 'Easy',
  intermediate: 'Medium',
  hard: 'Hard',
};

/**
 * The face of each subject.
 *
 * Emoji rather than an icon set, for the same reason the web picked them: six subjects have to be
 * told apart at a glance by a child who may not read the label, and every platform already renders
 * these in colour without shipping an asset. They live here rather than in each client because both
 * clients draw the same picker and a subject that is a globe on the web and a book on the phone is
 * the same bug as a mislabelled one.
 */
export const GAME_CATEGORY_EMOJI: Record<GameCategory, string> = {
  maths: '\u{1F522}',
  science: '\u{1F52C}',
  geography: '\u{1F30D}',
  vocabulary: '\u{1F4D6}',
  grammar: '\u{270F}\u{FE0F}',
  puzzle: '\u{1F9E9}',
};

/**
 * Points and XP per completed game, by level.
 *
 * ## Why these numbers, and why they live in code rather than in the database
 *
 * A child can hold at most 3 active tasks (`assignmentLimits.ts`), and a medium task pays 20 points, so
 * an engaged child earns roughly **60–90 points/day from chores** once streak and early-completion
 * bonuses are counted. Rewards cost 25–120 points.
 *
 * Games used to pay a flat 20 points per play. Across six categories that is ~120/day — clipped only by
 * the family's `maxGamePointsPerDay` (default 100). Games therefore **out-earned chores**, and the most
 * expensive reward was about a day and a half of pure quiz-playing with no tasks done at all. That is the
 * hole these values close.
 *
 * At 2/3/4, once per category per day (see `GAME_POINTS_ONCE_PER_CATEGORY_PER_DAY`), the **worst case** —
 * a child acing all six categories at the hardest level on the same day — is 6 × 4 = **24 points**, against
 * a floor of ~60 from chores. Games are at most ~40% of a bare chore day and cannot, on their own, afford
 * even the cheapest reward (25 points) in a single day.
 *
 * `hard` is 4 rather than 5 for exactly that reason: at 5 the worst case is 30, which is half a chore day
 * and enough to buy the cheapest reward daily without doing a single task. A test in
 * `backend/tests/game-grading.test.ts` pins the relationship so tuning these values cannot quietly break
 * it.
 *
 * XP goes UP, deliberately: level 2 costs 100 XP, so ~150 XP/day means levels move faster than before.
 * The child experiences a buff while the reward economy tightens, which is the only version of this
 * change that does not feel like a punishment.
 *
 * These are **constants, not columns**. `GameDefinition.pointsReward`/`xpReward` still exist and are
 * backfilled to match, but the award path reads these — so a typo in the admin UI cannot break the
 * economy. `GameService.rewardsForLevel()` is the single accessor.
 */
export const GAME_REWARDS: Record<GameLevel, { points: number; xp: number }> = {
  beginner: { points: 2, xp: 15 },
  intermediate: { points: 3, xp: 25 },
  hard: { points: 4, xp: 40 },
};

/**
 * Spendable points are awarded at most **once per category per day**; further plays that day earn XP
 * only.
 *
 * This is the mechanism a child can actually predict — "Maths ✓, today's points earned, play again for
 * XP" — as opposed to a silent daily cap that hands back 0 points and reads as the app cheating them.
 * Only a session that actually paid points consumes the day's allowance, so scoring below the accuracy
 * floor does not lock the category out.
 */
export const GAME_POINTS_ONCE_PER_CATEGORY_PER_DAY = true;

/**
 * Cooldown per CATEGORY, in hours — not per game.
 *
 * Completing any game in a category puts the whole category on its timer, which is what stops a child
 * clearing six near-identical maths sets back to back. Shorter where banks are cheap to author and
 * repetition is genuinely useful; longer where questions are expensive to write well.
 */
export const GAME_COOLDOWN_HOURS: Record<GameCategory, number> = {
  maths: 8,
  science: 8,
  geography: 12,
  vocabulary: 6,
  grammar: 6,
  puzzle: 4,
};

/**
 * Minimum share correct to earn anything at all.
 *
 * Below this a session pays neither points nor XP, so clicking through options at random is worth
 * nothing. Above it, points scale with the share correct (partial credit) and XP is paid in full — 3 of 5
 * still earns, which is what partial credit was introduced for.
 *
 * One threshold rather than two on purpose: a child cannot reason about "60% for XP but 50% for points".
 */
export const GAME_REWARD_ACCURACY_FLOOR = 0.6;

/** Maps the legacy per-game `difficulty` column onto the new level axis. */
export const LEGACY_DIFFICULTY_TO_LEVEL: Record<string, GameLevel> = {
  easy: 'beginner',
  medium: 'intermediate',
  hard: 'hard',
};
