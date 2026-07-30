/**
 * scripts/retier-maths-beginner.ts
 *
 * One-time re-tier of the "Math Challenge" bank into a genuine BEGINNER level.
 *
 * ## Why it is needed
 *
 * "Math Challenge" predates the level system. It was authored as one general mixed quiz and contains
 * percentages, indices, square roots and order of operations — material that belongs at intermediate.
 * The games redesign assigned it to `maths / beginner`, so the three levels did not read as three steps.
 *
 * `seedGames()` deliberately skips definitions that already exist (so it never clobbers admin edits),
 * which means the re-tiered bank in `content/games/maths.ts` reaches a fresh install and NOTHING else.
 * Only a script can apply it to a deployment that already has the row.
 *
 * ## What it does, and the part that is easy to miss
 *
 * 1. Replaces the definition's `questionsJson` with `MATHS_BEGINNER`.
 * 2. **Deletes `GameQuestionSeen` rows for questions that no longer exist in the bank.**
 *
 * Step 2 is not tidiness. `coverage` in the games report counts seen rows per (child, definition)
 * against the bank size, so a child who had seen all 25 old questions would show 25/30 against the new
 * bank — reported as nearly exhausted when in truth they have seen none of the new material. The
 * rotation itself tolerates stale ids (it intersects the bank with what was seen), so this is a
 * reporting correctness fix, and it is invisible until a parent reads a number and believes it.
 *
 * Five questions are retired (m03, m04, m05, m14, m24) and twenty keep their original ids and text —
 * so those children keep their rotation history exactly, and only the retired ones are forgotten.
 *
 * ## What it deliberately does NOT touch
 *
 * Past sessions. `GameSession.servedQuestionsJson` is a snapshot taken at creation, so completed games
 * still grade and review against the questions that were actually served, and an in-progress session
 * spanning this deploy finishes correctly. That snapshot exists for precisely this situation.
 *
 * Idempotent: re-running replaces identical content and finds no stale rows to delete.
 *
 * Per docs/DEPLOYMENT.md this is a one-off DATA script: run it AFTER `db:migrate:prod` and AFTER the
 * build, before restarting the services. Runnable from any directory:
 *
 *   node backend/dist/scripts/retier-maths-beginner.js
 */

// Loads backend/.env by ABSOLUTE path (config/index.ts resolves it from __dirname). Deliberately NOT
// `import 'dotenv/config'`, which resolves from the working directory — there is no .env at the repo
// root on the VPS.
import '../config';
import { MATHS_BEGINNER } from '../content/games/maths';
import { prisma } from '../services/database';

/** The title the definition was seeded under. Matching on it is how seedGames identifies it too. */
const TITLE = 'Math Challenge';

export async function retierMathsBeginner(): Promise<void> {
  const definition = await prisma.gameDefinition.findFirst({ where: { title: TITLE } });

  if (!definition) {
    // A fresh install seeds the re-tiered bank directly, so there is nothing to do and that is not an
    // error worth failing a deploy over.
    console.log(`[Games] No "${TITLE}" definition found — nothing to re-tier.`);
    return;
  }

  const before = ((definition.questionsJson as unknown as { id: string }[]) ?? []).map((q) => q.id);
  const after = MATHS_BEGINNER.map((q) => q.id);
  const retired = before.filter((id) => !after.includes(id));

  await prisma.gameDefinition.update({
    where: { id: definition.id },
    data: { questionsJson: MATHS_BEGINNER as unknown as object[] },
  });

  console.log(
    `[Games] "${TITLE}": ${before.length} → ${after.length} questions ` +
      `(${retired.length} retired: ${retired.join(', ') || 'none'})`,
  );

  // Scoped to THIS definition. A question id is only unique within its own bank, so an unscoped delete
  // could remove a child's history for an identically-named question in another game.
  const { count } = await prisma.gameQuestionSeen.deleteMany({
    where: {
      gameDefinitionId: definition.id,
      questionId: { notIn: after },
    },
  });

  console.log(`[Games] Cleared ${count} stale rotation row(s) for retired questions.`);
}

async function main(): Promise<void> {
  console.log('[Games] Re-tiering the maths beginner bank…');
  await retierMathsBeginner();
  console.log('[Games] Done.');
}

main()
  .catch((error) => {
    console.error('[Games] Re-tier failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
