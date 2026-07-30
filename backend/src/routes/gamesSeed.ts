/**
 * gamesSeed.ts - Seed the initial quiz game definitions and their question BANKS.
 * Called once from the games router on first run OR via prisma/seed.ts.
 *
 * Each game holds a bank far larger than one play. A session draws `questionsPerSession` from it,
 * seeded by game + UTC date, so the quiz rotates daily instead of serving the same five questions
 * forever. Banks are sized so a child does not see a repeat for weeks.
 *
 * Safe to call repeatedly: existing definitions are left alone (see seedGames), so an admin's edits
 * via /admin/games are never overwritten by a redeploy.
 */
import { prisma } from '../services/database';
import { MATHS_BEGINNER, MATHS_HARD, MATHS_INTERMEDIATE } from '../content/games/maths';
import { SCIENCE_BEGINNER, SCIENCE_HARD, SCIENCE_INTERMEDIATE } from '../content/games/science';
import {
  GEOGRAPHY_BEGINNER,
  GEOGRAPHY_HARD,
  GEOGRAPHY_INTERMEDIATE,
} from '../content/games/geography';
import {
  VOCABULARY_BEGINNER,
  VOCABULARY_HARD,
  VOCABULARY_INTERMEDIATE,
} from '../content/games/vocabulary';
import { GRAMMAR_BEGINNER, GRAMMAR_HARD, GRAMMAR_INTERMEDIATE } from '../content/games/grammar';
import { PUZZLE_BEGINNER, PUZZLE_HARD, PUZZLE_INTERMEDIATE } from '../content/games/puzzle';

const QUIZ_GAMES = [
  {
    type: 'quiz',
    title: 'Math Challenge',
    description: 'Test your arithmetic skills!',
    category: 'maths' as const,
    level: 'beginner' as const,
    difficulty: 'easy' as const,
    // Display-only; the award path reads GAME_REWARDS[level]. Kept in step with it deliberately.
    pointsReward: 2,
    xpReward: 15,
    cooldownHours: 8,
    // Null from here on: the redesign lets a child pick any level at any age.
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: MATHS_BEGINNER,
  },
  {
    type: 'quiz',
    title: 'Science Quiz',
    description: 'How well do you know the natural world?',
    category: 'science' as const,
    level: 'beginner' as const,
    difficulty: 'easy' as const,
    pointsReward: 2,
    xpReward: 15,
    cooldownHours: 8,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: SCIENCE_BEGINNER,
  },
  {
    type: 'quiz',
    title: 'World Geography',
    description: 'Test your knowledge of world capitals and countries!',
    category: 'geography' as const,
    level: 'beginner' as const,
    difficulty: 'easy' as const,
    pointsReward: 2,
    xpReward: 15,
    cooldownHours: 12,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: GEOGRAPHY_BEGINNER,
  },
  // ── Phase D content ─────────────────────────────────────────────────────────
  //
  // Banks live in src/content/games/ — eighteen of them inline here would be unreadable. `maths /
  // beginner` is deliberately absent: it already exists above as "Math Challenge", and seedGames matches
  // on title, so re-declaring it would be a no-op at best and a duplicate row at worst.
  {
    type: 'quiz',
    title: 'Maths Workout',
    description: 'Percentages, ratios, shapes and a bit of algebra.',
    category: 'maths' as const,
    level: 'intermediate' as const,
    difficulty: 'medium' as const,
    // Display-only; the award path reads GAME_REWARDS[level].
    pointsReward: 3,
    xpReward: 25,
    cooldownHours: 8,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: MATHS_INTERMEDIATE,
  },
  {
    type: 'quiz',
    title: 'Maths Master',
    description: 'Algebra, powers, probability and compound percentages.',
    category: 'maths' as const,
    level: 'hard' as const,
    difficulty: 'hard' as const,
    pointsReward: 4,
    xpReward: 40,
    cooldownHours: 8,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: MATHS_HARD,
  },
  {
    type: 'quiz',
    title: 'Science Lab',
    description: 'Matter, energy, the human body and simple chemistry.',
    category: 'science' as const,
    level: 'intermediate' as const,
    difficulty: 'medium' as const,
    pointsReward: 3,
    xpReward: 25,
    cooldownHours: 8,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: SCIENCE_INTERMEDIATE,
  },
  {
    type: 'quiz',
    title: 'Science Master',
    description: 'Atoms, genetics, forces and the laws behind them.',
    category: 'science' as const,
    level: 'hard' as const,
    difficulty: 'hard' as const,
    pointsReward: 4,
    xpReward: 40,
    cooldownHours: 8,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: SCIENCE_HARD,
  },
  {
    type: 'quiz',
    title: 'World Explorer',
    description: 'Rivers, ranges, oceans and the capitals people get wrong.',
    category: 'geography' as const,
    level: 'intermediate' as const,
    difficulty: 'medium' as const,
    pointsReward: 3,
    xpReward: 25,
    cooldownHours: 12,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: GEOGRAPHY_INTERMEDIATE,
  },
  {
    type: 'quiz',
    title: 'World Master',
    description: 'Tectonics, named features and the trickiest capitals of all.',
    category: 'geography' as const,
    level: 'hard' as const,
    difficulty: 'hard' as const,
    pointsReward: 4,
    xpReward: 40,
    cooldownHours: 12,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: GEOGRAPHY_HARD,
  },
  {
    type: 'quiz',
    title: 'Word Starter',
    description: 'Everyday words, opposites and words that mean the same.',
    category: 'vocabulary' as const,
    level: 'beginner' as const,
    difficulty: 'easy' as const,
    pointsReward: 2,
    xpReward: 15,
    cooldownHours: 6,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: VOCABULARY_BEGINNER,
  },
  {
    type: 'quiz',
    title: 'Word Builder',
    description: 'Prefixes, suffixes and words you meet in books.',
    category: 'vocabulary' as const,
    level: 'intermediate' as const,
    difficulty: 'medium' as const,
    pointsReward: 3,
    xpReward: 25,
    cooldownHours: 6,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: VOCABULARY_INTERMEDIATE,
  },
  {
    type: 'quiz',
    title: 'Word Master',
    description: 'Precise words, Latin and Greek roots, and easy mix-ups.',
    category: 'vocabulary' as const,
    level: 'hard' as const,
    difficulty: 'hard' as const,
    pointsReward: 4,
    xpReward: 40,
    cooldownHours: 6,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: VOCABULARY_HARD,
  },
  {
    type: 'quiz',
    title: 'Grammar Starter',
    description: 'Nouns, verbs, plurals and full stops.',
    category: 'grammar' as const,
    level: 'beginner' as const,
    difficulty: 'easy' as const,
    pointsReward: 2,
    xpReward: 15,
    cooldownHours: 6,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: GRAMMAR_BEGINNER,
  },
  {
    type: 'quiz',
    title: 'Grammar Builder',
    description: 'Its and it’s, agreement, tenses and apostrophes.',
    category: 'grammar' as const,
    level: 'intermediate' as const,
    difficulty: 'medium' as const,
    pointsReward: 3,
    xpReward: 25,
    cooldownHours: 6,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: GRAMMAR_INTERMEDIATE,
  },
  {
    type: 'quiz',
    title: 'Grammar Master',
    description: 'Clauses, mood, and the ones that trip up adults.',
    category: 'grammar' as const,
    level: 'hard' as const,
    difficulty: 'hard' as const,
    pointsReward: 4,
    xpReward: 40,
    cooldownHours: 6,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: GRAMMAR_HARD,
  },
  {
    type: 'quiz',
    title: 'Brain Starter',
    description: 'Odd one out, patterns and simple thinking.',
    category: 'puzzle' as const,
    level: 'beginner' as const,
    difficulty: 'easy' as const,
    pointsReward: 2,
    xpReward: 15,
    cooldownHours: 4,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: PUZZLE_BEGINNER,
  },
  {
    type: 'quiz',
    title: 'Brain Builder',
    description: 'Analogies, number patterns and short deductions.',
    category: 'puzzle' as const,
    level: 'intermediate' as const,
    difficulty: 'medium' as const,
    pointsReward: 3,
    xpReward: 25,
    cooldownHours: 4,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: PUZZLE_INTERMEDIATE,
  },
  {
    type: 'quiz',
    title: 'Brain Master',
    description: 'Famous puzzles where the obvious answer is wrong.',
    category: 'puzzle' as const,
    level: 'hard' as const,
    difficulty: 'hard' as const,
    pointsReward: 4,
    xpReward: 40,
    cooldownHours: 4,
    ageGroup: null as string | null,
    questionsPerSession: 5,
    questionsJson: PUZZLE_HARD,
  },
];

export async function seedGames(): Promise<void> {
  for (const game of QUIZ_GAMES) {
    const existing = await prisma.gameDefinition.findFirst({ where: { title: game.title } });
    if (!existing) {
      // Cast only here: the arrays stay strongly typed above so backfillGameBanks can read id/text.
      await prisma.gameDefinition.create({ data: game as unknown as Parameters<typeof prisma.gameDefinition.create>[0]['data'] });
      console.log(`[Games] Seeded: ${game.title} (${game.questionsJson.length} questions)`);
    }
  }
}

/**
 * Top up the SEEDED games to their full banks without touching anything else.
 *
 * The original seed shipped 5 questions per game and `seedGames` skips definitions that already
 * exist, so an existing deployment would keep serving the same five questions forever and the daily
 * rotation would have nothing to rotate. This backfills only questions whose id is missing, so
 * admin-authored questions and edited metadata are preserved.
 *
 * Run once after deploying rotation:
 *   node backend/dist/scripts/backfill-game-banks.js
 */
/** Normalise question text for duplicate detection: case, surrounding and repeated whitespace. */
function normaliseText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function backfillGameBanks(): Promise<void> {
  for (const game of QUIZ_GAMES) {
    const existing = await prisma.gameDefinition.findFirst({ where: { title: game.title } });
    if (!existing) continue;

    const current =
      (existing.questionsJson as unknown as Array<{ id: string; text: string }>) ?? [];
    const currentIds = new Set(current.map((q) => q.id));
    // Match on TEXT as well as id. The original seed used ids q1-q5 for every game while the banks
    // here use per-topic ids (m01, s01, g01...), so an id-only check finds no overlap and appends
    // all 25 - leaving the first five duplicated under two ids. A daily draw treats those as
    // distinct entries and could serve the same question twice in one quiz.
    const currentTexts = new Set(current.map((q) => normaliseText(q.text ?? '')));

    const missing = game.questionsJson.filter(
      (q) => !currentIds.has(q.id) && !currentTexts.has(normaliseText(q.text)),
    );

    if (missing.length === 0) {
      console.log(`[Games] ${game.title}: bank already complete (${current.length} questions)`);
      continue;
    }

    await prisma.gameDefinition.update({
      where: { id: existing.id },
      data: { questionsJson: [...current, ...missing] },
    });
    console.log(
      `[Games] ${game.title}: added ${missing.length} questions (${current.length} → ${current.length + missing.length})`,
    );
  }
}
