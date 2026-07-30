/**
 * routes/games.ts - PE Mini Games
 * Mounted at /api/v1/games
 *
 * GET  /games                     - list active game definitions with cooldown status
 * POST /games/sessions            - start a session, return questions WITHOUT answers
 * GET  /games/sessions/:id        - resume an in-progress session (survives a page refresh)
 * POST /games/sessions/:id/answer - lock ONE answer, reveal whether it was right
 * POST /games/sessions/:id/submit - finalise, award partial credit, return a per-question review
 *
 * Answer flow: the client locks each answer as it goes and is told immediately whether it was
 * correct. The reveal is safe because the choice is committed to the DB first and re-answering a
 * question is rejected — so a child cannot probe the endpoint once per option to find the answer.
 * Grading reads the stored answers; the client's submitted array is no longer trusted.
 */

import { Router } from 'express';
import { prisma } from '../services/database';
import { authenticate, requireChild } from '../middleware/auth';
import {
  ValidationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../middleware/errorHandler';
import {
  Question,
  allAnswered,
  buildReview,
  computeAward,
  countCorrect,
  displayIndexOfCorrect,
  emptyAnswers,
  cooldownHoursForCategory,
  isAgeAppropriate,
  isCorrect,
  parseAnswers,
  resolveSessionQuestions,
  rewardsForLevel,
  selectQuestionsForChild,
  toClientQuestions,
  toOriginalIndex,
} from '../services/GameService';

export const gamesRouter = Router();

gamesRouter.use(authenticate, requireChild);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The definition's full question BANK (not what a single session serves). */
function bankOf(def: { questionsJson: unknown }): Question[] {
  const bank = def.questionsJson as unknown as Question[];
  return Array.isArray(bank) ? bank : [];
}

/** Load a session that the caller is allowed to play, or throw. */
async function loadPlayableSession(sessionId: string, childId: string) {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: { gameDefinition: true },
  });

  if (!session) throw new NotFoundError('Game session not found');
  if (session.childId !== childId) throw new ForbiddenError('Not your session');
  if (session.status !== 'in_progress') {
    throw new ConflictError(`Session is already ${session.status}`);
  }
  if (session.expiresAt < new Date()) {
    await prisma.gameSession.update({
      where: { id: sessionId },
      data: { status: 'expired' },
    });
    throw new ConflictError('Session has expired');
  }

  return session;
}

/**
 * The questions a session is graded against - its own snapshot, or the definition's bank for
 * sessions created before rotation existed.
 */
function servedQuestionsOf(session: {
  servedQuestionsJson: unknown;
  gameDefinition: { questionsJson: unknown };
}): Question[] {
  return resolveSessionQuestions(session.servedQuestionsJson, bankOf(session.gameDefinition));
}

// ─── GET /games ───────────────────────────────────────────────────────────────

gamesRouter.get('/', async (req, res, next) => {
  try {
    const childId = req.user!.userId;
    const [allDefinitions, childProfile] = await Promise.all([
      prisma.gameDefinition.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.childProfile.findUnique({
        where: { userId: childId },
        select: { dateOfBirth: true },
      }),
    ]);

    // Age gate. Kept for `ageGroup`-tagged legacy definitions only — the redesign lets a child pick any
    // level at any age, with appropriateness carried by the authored content instead of a gate. New
    // category/level definitions ship with ageGroup null and are therefore always eligible.
    const definitions = allDefinitions.filter((def) =>
      isAgeAppropriate(def.ageGroup, childProfile?.dateOfBirth ?? null),
    );

    const now = new Date();

    /**
     * Cooldown is per CATEGORY, not per game: finishing any maths game times out every maths game.
     * Computed with one grouped query rather than per definition, so adding levels and categories does
     * not multiply the round trips.
     */
    const lastPerCategory = await prisma.gameSession.findMany({
      where: { childId, status: 'completed', submittedAt: { not: null } },
      select: { submittedAt: true, gameDefinition: { select: { category: true } } },
      orderBy: { submittedAt: 'desc' },
    });

    const lastPlayedAt = new Map<string, Date>();
    for (const s of lastPerCategory) {
      const key = s.gameDefinition.category;
      if (!lastPlayedAt.has(key) && s.submittedAt) lastPlayedAt.set(key, s.submittedAt);
    }

    const gamesWithStatus = definitions.map((def) => {
      const cooldownHours = cooldownHoursForCategory(def.category);
      const last = lastPlayedAt.get(def.category);

      let cooldownEndsAt: Date | null = null;
      let onCooldown = false;
      if (last) {
        cooldownEndsAt = new Date(last.getTime() + cooldownHours * 3600_000);
        onCooldown = cooldownEndsAt > now;
      }

      const { points, xp } = rewardsForLevel(def.level);

      return {
        id: def.id,
        type: def.type,
        title: def.title,
        description: def.description,
        category: def.category,
        level: def.level,
        // Retained so the existing child games page keeps rendering unchanged; `level` supersedes it.
        difficulty: def.difficulty,
        // From the level, not the column — see the note on GAME_REWARDS. The two agree after the
        // migration's backfill, but the level is what actually gets paid.
        pointsReward: points,
        xpReward: xp,
        cooldownHours,
        ageGroup: def.ageGroup,
        questionCount: Math.min(def.questionsPerSession, bankOf(def).length),
        onCooldown,
        cooldownEndsAt,
      };
    });

    res.json({ success: true, data: { games: gamesWithStatus } });
  } catch (error) {
    next(error);
  }
});

// ─── POST /games/sessions ─────────────────────────────────────────────────────

gamesRouter.post('/sessions', async (req, res, next) => {
  try {
    const childId = req.user!.userId;
    const { gameDefinitionId } = req.body as { gameDefinitionId: string };

    const def = await prisma.gameDefinition.findFirst({
      where: { id: gameDefinitionId, isActive: true },
    });
    if (!def) throw new NotFoundError('Game not found');

    /**
     * Cooldown is CATEGORY-wide: any completed game in this category holds the whole category. Without
     * that, six near-identical maths sets could be cleared back to back.
     */
    const lastInCategory = await prisma.gameSession.findFirst({
      where: {
        childId,
        status: 'completed',
        submittedAt: { not: null },
        gameDefinition: { category: def.category },
      },
      orderBy: { submittedAt: 'desc' },
      select: { submittedAt: true },
    });
    if (lastInCategory?.submittedAt) {
      const cooldownEnd = new Date(
        lastInCategory.submittedAt.getTime() + cooldownHoursForCategory(def.category) * 3600_000,
      );
      if (cooldownEnd > new Date()) {
        throw new ConflictError(
          `${def.category} is on cooldown. Try again at ${cooldownEnd.toISOString()}.`,
        );
      }
    }

    // Expire any lingering in_progress session for this game
    await prisma.gameSession.updateMany({
      where: { childId, gameDefinitionId, status: 'in_progress' },
      data: { status: 'expired' },
    });

    /**
     * Draw from what THIS child has not seen, recycling the least-recently-seen once the bank runs out.
     * The seed is per-play so two plays of the same unseen pool are not served in the same order.
     */
    const seen = await prisma.gameQuestionSeen.findMany({
      where: { childId, gameDefinitionId },
      select: { questionId: true, seenAt: true },
    });

    const questions = selectQuestionsForChild(
      bankOf(def),
      def.questionsPerSession,
      seen,
      `${childId}:${def.id}:${Date.now()}`,
    );
    if (questions.length === 0) throw new ConflictError('This game has no questions yet');

    // Session expires in 2× estimated solve time (min 10 min, max 60 min)
    const estimatedMs = questions.length * 60_000; // 1 min per question default
    const expiresAt = new Date(Date.now() + Math.min(Math.max(estimatedMs * 2, 600_000), 3_600_000));

    const session = await prisma.gameSession.create({
      data: {
        childId,
        gameDefinitionId,
        // Legacy column: kept non-null for older rows/readers. Grading no longer uses it.
        solutionHash: '',
        answersJson: emptyAnswers(questions.length),
        // Snapshot, so editing the bank mid-session cannot misalign the stored answers.
        servedQuestionsJson: questions as unknown as object[],
        expiresAt,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        game: {
          title: def.title,
          difficulty: def.difficulty,
          pointsReward: def.pointsReward,
          xpReward: def.xpReward,
        },
        // Options are shuffled per session; answers stripped.
        questions: toClientQuestions(questions, session.id),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /games/sessions/:id ──────────────────────────────────────────────────

/**
 * Resume. The play screen fetches this on mount instead of trusting sessionStorage, so a refresh
 * (or a soft-logout/PIN resume) drops the child back where they were rather than silently
 * abandoning an in_progress session.
 */
gamesRouter.get('/sessions/:id', async (req, res, next) => {
  try {
    const childId = req.user!.userId;
    const session = await loadPlayableSession(req.params.id, childId);
    const def = session.gameDefinition;
    const questions = servedQuestionsOf(session);
    const answers = parseAnswers(session.answersJson, questions.length);

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        expiresAt: session.expiresAt,
        game: {
          title: def.title,
          difficulty: def.difficulty,
          pointsReward: def.pointsReward,
          xpReward: def.xpReward,
        },
        questions: toClientQuestions(questions, session.id),
        // Which questions are already locked, in display order — enough to resume, and it reveals
        // nothing about the ones still unanswered.
        answeredCount: answers.filter((a) => a !== null).length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /games/sessions/:id/answer ──────────────────────────────────────────

/**
 * Lock one answer and reveal whether it was right.
 *
 * The write happens BEFORE the reveal and a second answer to the same question is rejected with
 * 409, which is what makes returning `correctIndex` safe: by the time the child learns the answer,
 * their own choice is already final.
 */
gamesRouter.post('/sessions/:id/answer', async (req, res, next) => {
  try {
    const childId = req.user!.userId;
    const { questionIndex, answerIndex } = req.body as {
      questionIndex: number;
      answerIndex: number;
    };

    const session = await loadPlayableSession(req.params.id, childId);
    const questions = servedQuestionsOf(session);

    if (
      !Number.isInteger(questionIndex) ||
      questionIndex < 0 ||
      questionIndex >= questions.length
    ) {
      throw new ValidationError('Invalid questionIndex');
    }

    const question = questions[questionIndex];
    if (
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex >= question.options.length
    ) {
      throw new ValidationError('Invalid answerIndex');
    }

    const answers = parseAnswers(session.answersJson, questions.length);
    if (answers[questionIndex] !== null) {
      throw new ConflictError('Question already answered');
    }

    // The client answers in display order; store the original index so grading is independent of
    // the permutation.
    const originalIndex = toOriginalIndex(
      answerIndex,
      session.id,
      questionIndex,
      question.options.length,
    );
    answers[questionIndex] = originalIndex;

    // Conditional write: only claim the slot if it is still unset, so two racing requests for the
    // same question cannot both succeed.
    const claimed = await prisma.gameSession.updateMany({
      where: { id: session.id, status: 'in_progress' },
      data: { answersJson: answers },
    });
    if (claimed.count === 0) throw new ConflictError('Session is no longer in progress');

    const correctDisplayIndex = displayIndexOfCorrect(question, session.id, questionIndex);

    res.json({
      success: true,
      data: {
        questionIndex,
        correct: originalIndex === question.correctIndex,
        // Safe to reveal: the answer above is already committed.
        correctIndex: correctDisplayIndex,
        answeredCount: answers.filter((a) => a !== null).length,
        totalQuestions: questions.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /games/sessions/:id/submit ─────────────────────────────────────────

gamesRouter.post('/sessions/:id/submit', async (req, res, next) => {
  try {
    const childId = req.user!.userId;
    const { id } = req.params;

    const session = await loadPlayableSession(id, childId);
    const def = session.gameDefinition;
    const questions = servedQuestionsOf(session);
    const answers = parseAnswers(session.answersJson, questions.length);

    if (!allAnswered(answers)) {
      throw new ValidationError('All questions must be answered before submitting');
    }

    const correctCount = countCorrect(questions, answers);
    const review = buildReview(questions, answers, session.id);
    const now = new Date();

    // Daily cap check
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const settings = await prisma.familySettings.findFirst({
      where: { family: { users: { some: { id: childId } } } },
      select: { maxGamePointsPerDay: true },
    });
    const cap = (settings as any)?.maxGamePointsPerDay ?? 100;

    const earnedToday = await prisma.gameSession.aggregate({
      _sum: { pointsAwarded: true },
      where: { childId, status: 'completed', submittedAt: { gte: todayStart } },
    });
    const todayPoints = earnedToday._sum.pointsAwarded ?? 0;
    const remaining = Math.max(0, cap - todayPoints);

    /**
     * Spendable points are once per category per day; further plays that day earn XP only.
     *
     * Keyed on `pointsAwarded > 0`, so a session that scored below the accuracy floor and paid nothing
     * does NOT consume the day's allowance — otherwise one bad round would lock the subject out.
     */
    const alreadyPaidInCategoryToday = await prisma.gameSession.findFirst({
      where: {
        childId,
        status: 'completed',
        submittedAt: { gte: todayStart },
        pointsAwarded: { gt: 0 },
        gameDefinition: { category: def.category },
      },
      select: { id: true },
    });

    const { pointsAwarded, xpAwarded, cappedMessage } = computeAward(
      def.level,
      correctCount,
      questions.length,
      remaining,
      alreadyPaidInCategoryToday !== null,
    );

    // Award points + close the session in one transaction.
    await prisma.$transaction(async (tx) => {
      // Conditional close: a concurrent submit that got here first flips the status, so the second
      // one awards nothing.
      const closed = await tx.gameSession.updateMany({
        where: { id, status: 'in_progress' },
        data: { status: 'completed', submittedAt: now, pointsAwarded, xpAwarded },
      });
      if (closed.count === 0) throw new ConflictError('Session is no longer in progress');

      /**
       * Record what this child has now been graded on — the rotation index.
       *
       * Inside the transaction and after the conditional close, so a session that lost the concurrent
       * -submit race never marks its questions consumed. `skipDuplicates` covers the recycle case, where
       * a question the child has seen before comes round again and its row already exists; the original
       * `seenAt` is deliberately left alone so the least-recently-seen ordering stays stable rather than
       * a recycled question jumping to the back of the queue twice.
       */
      await tx.gameQuestionSeen.createMany({
        data: questions.map((q, i) => ({
          childId,
          gameDefinitionId: session.gameDefinitionId,
          questionId: q.id,
          seenAt: now,
          wasCorrect: isCorrect(q, answers[i]),
        })),
        skipDuplicates: true,
      });

      if (pointsAwarded > 0 || xpAwarded > 0) {
        const profile = await tx.childProfile.findUnique({ where: { userId: childId } });
        if (profile) {
          const newBalance = profile.pointsBalance + pointsAwarded;
          await tx.childProfile.update({
            where: { userId: childId },
            data: {
              pointsBalance: newBalance,
              totalPointsEarned: { increment: pointsAwarded },
              experiencePoints: { increment: xpAwarded },
              totalXpEarned: { increment: xpAwarded },
            },
          });

          if (pointsAwarded > 0) {
            await tx.pointsLedger.create({
              data: {
                childId,
                transactionType: 'game_reward',
                pointsAmount: pointsAwarded,
                balanceAfter: newBalance,
                referenceType: 'game_session',
                referenceId: id,
                description: `Game completed: ${def.title} (${correctCount}/${questions.length})`,
                breakdown: { points: pointsAwarded, xp: xpAwarded, correctCount, totalQuestions: questions.length },
              },
            });
          }
        }
      }
    });

    res.json({
      success: true,
      data: {
        correctCount,
        totalQuestions: questions.length,
        // Retained so existing clients keep working: true only on a clean sweep.
        correct: correctCount === questions.length,
        pointsAwarded,
        xpAwarded,
        cappedMessage,
        review,
      },
    });
  } catch (error) {
    next(error);
  }
});
