/**
 * routes/games.ts - PE Mini Games
 * Mounted at /api/v1/games
 *
 * GET  /games              - list active game definitions with cooldown status
 * POST /games/sessions     - start a session, return questions WITHOUT answers
 * POST /games/sessions/:id/submit - submit answers, award points if correct
 */

import crypto from 'crypto';
import { Router } from 'express';
import { prisma } from '../services/database';
import { authenticate, requireChild } from '../middleware/auth';
import { ConflictError, ForbiddenError, NotFoundError } from '../middleware/errorHandler';

export const gamesRouter = Router();

gamesRouter.use(authenticate, requireChild);

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex: number; // stored server-side, NEVER sent to client
}

function hashAnswers(answers: number[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(answers)).digest('hex');
}

function stripAnswers(questions: Question[]): Omit<Question, 'correctIndex'>[] {
  return questions.map(({ id, text, options }) => ({ id, text, options }));
}

// ─── GET /games ───────────────────────────────────────────────────────────────

gamesRouter.get('/', async (req, res, next) => {
  try {
    const childId = req.user!.userId;
    const definitions = await prisma.gameDefinition.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    // For each game, find the last session to compute cooldown
    const now = new Date();
    const gamesWithStatus = await Promise.all(
      definitions.map(async (def) => {
        const lastSession = await prisma.gameSession.findFirst({
          where: { childId, gameDefinitionId: def.id, status: 'completed' },
          orderBy: { submittedAt: 'desc' },
        });

        let cooldownEndsAt: Date | null = null;
        let onCooldown = false;
        if (lastSession?.submittedAt) {
          cooldownEndsAt = new Date(
            lastSession.submittedAt.getTime() + def.cooldownHours * 3600_000,
          );
          onCooldown = cooldownEndsAt > now;
        }

        return {
          id: def.id,
          type: def.type,
          title: def.title,
          description: def.description,
          difficulty: def.difficulty,
          pointsReward: def.pointsReward,
          xpReward: def.xpReward,
          cooldownHours: def.cooldownHours,
          ageGroup: def.ageGroup,
          questionCount: (def.questionsJson as Question[]).length,
          onCooldown,
          cooldownEndsAt,
        };
      }),
    );

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

    // Cooldown check
    const lastCompleted = await prisma.gameSession.findFirst({
      where: { childId, gameDefinitionId, status: 'completed' },
      orderBy: { submittedAt: 'desc' },
    });
    if (lastCompleted?.submittedAt) {
      const cooldownEnd = new Date(
        lastCompleted.submittedAt.getTime() + def.cooldownHours * 3600_000,
      );
      if (cooldownEnd > new Date()) {
        throw new ConflictError(
          `Game is on cooldown. Try again at ${cooldownEnd.toISOString()}.`,
        );
      }
    }

    // Expire any lingering in_progress session for this game
    await prisma.gameSession.updateMany({
      where: { childId, gameDefinitionId, status: 'in_progress' },
      data: { status: 'expired' },
    });

    const questions = def.questionsJson as Question[];
    const correctAnswers = questions.map((q) => q.correctIndex);
    const solutionHash = hashAnswers(correctAnswers);

    // Session expires in 2× estimated solve time (min 10 min, max 60 min)
    const estimatedMs = questions.length * 60_000; // 1 min per question default
    const expiresAt = new Date(Date.now() + Math.min(Math.max(estimatedMs * 2, 600_000), 3_600_000));

    const session = await prisma.gameSession.create({
      data: { childId, gameDefinitionId, solutionHash, expiresAt },
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
        questions: stripAnswers(questions), // answers stripped
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
    const { answers } = req.body as { answers: number[] };

    const session = await prisma.gameSession.findUnique({
      where: { id },
      include: { gameDefinition: true },
    });

    if (!session) throw new NotFoundError('Game session not found');
    if (session.childId !== childId) throw new ForbiddenError('Not your session');
    if (session.status !== 'in_progress') {
      throw new ConflictError(`Session is already ${session.status}`);
    }
    if (session.expiresAt < new Date()) {
      await prisma.gameSession.update({ where: { id }, data: { status: 'expired' } });
      throw new ConflictError('Session has expired');
    }

    const submittedHash = hashAnswers(answers);
    const correct = submittedHash === session.solutionHash;
    const now = new Date();

    if (!correct) {
      await prisma.gameSession.update({
        where: { id },
        data: { status: 'failed', submittedAt: now },
      });
      return res.json({ success: true, data: { correct: false, pointsAwarded: 0, xpAwarded: 0 } });
    }

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
    const pointsToAward = Math.min(session.gameDefinition.pointsReward, remaining);
    const xpToAward = pointsToAward > 0 ? session.gameDefinition.xpReward : 0;

    // Award points + update session in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.gameSession.update({
        where: { id },
        data: { status: 'completed', submittedAt: now, pointsAwarded: pointsToAward, xpAwarded: xpToAward },
      });

      if (pointsToAward > 0) {
        const profile = await tx.childProfile.findUnique({ where: { userId: childId } });
        if (profile) {
          const newBalance = profile.pointsBalance + pointsToAward;
          await tx.childProfile.update({
            where: { userId: childId },
            data: {
              pointsBalance: newBalance,
              totalPointsEarned: { increment: pointsToAward },
              experiencePoints: { increment: xpToAward },
              totalXpEarned: { increment: xpToAward },
            },
          });
          await tx.pointsLedger.create({
            data: {
              childId,
              transactionType: 'game_reward',
              pointsAmount: pointsToAward,
              balanceAfter: newBalance,
              referenceType: 'game_session',
              referenceId: id,
              description: `Game completed: ${session.gameDefinition.title}`,
              breakdown: { points: pointsToAward, xp: xpToAward },
            },
          });
        }
      }
    });

    res.json({
      success: true,
      data: {
        correct: true,
        pointsAwarded: pointsToAward,
        xpAwarded: xpToAward,
        cappedMessage: pointsToAward < session.gameDefinition.pointsReward
          ? `Daily game points cap reached. You earned ${pointsToAward} pts.`
          : undefined,
      },
    });
  } catch (error) {
    next(error);
  }
});
