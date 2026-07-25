/**
 * routes/adminGames.ts
 *
 * Admin CRUD for quiz game definitions and their question banks.
 * Mounted at /api/v1/admin/games — every route requires the admin JWT guard.
 *
 *   GET    /admin/games        - list every definition (incl. inactive) with play stats
 *   GET    /admin/games/:id    - full detail INCLUDING correct answers
 *   POST   /admin/games        - create
 *   PATCH  /admin/games/:id    - update metadata and/or the question bank
 *   DELETE /admin/games/:id    - deactivate (soft) or hard-delete when never played
 *
 * Before this existed, game content could only be changed by editing gamesSeed.ts and redeploying,
 * which made the daily rotation impractical to maintain — growing a bank was a code change.
 *
 * This is the ONE place correct answers are legitimately returned over the wire. The child-facing
 * routes in games.ts strip them; here the admin is authoring them, so `requireAdmin` is the only
 * thing standing between the bank and a child. Do not reuse these handlers for any other role.
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';
import { AuditService } from '../services/AuditService';
import { AGE_GROUPS, Question, validateQuestionBank } from '../services/GameService';

export const adminGamesRouter = Router();

adminGamesRouter.use(authenticate, requireAdmin);

// ─── Validation ───────────────────────────────────────────────────────────────

const questionSchema = z.object({
  id: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
  correctIndex: z.number().int().min(0),
});

const gameBodySchema = z.object({
  type: z.string().trim().min(1).max(32).default('quiz'),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  pointsReward: z.number().int().min(0).max(500),
  xpReward: z.number().int().min(0).max(500),
  cooldownHours: z.number().int().min(1).max(168),
  ageGroup: z.enum(AGE_GROUPS).nullable().optional(),
  questionsPerSession: z.number().int().min(1).max(50),
  questions: z.array(questionSchema).min(1).max(200),
  isActive: z.boolean().default(true),
});

/** PATCH accepts any subset; `questions` replaces the whole bank when present. */
const gamePatchSchema = gameBodySchema.partial();

/**
 * Cross-field checks zod cannot express on its own: correctIndex must be in range for its OWN
 * options array, and a draw larger than the bank would silently shrink.
 */
function assertBankConsistent(questions: Question[], questionsPerSession: number): void {
  const errors = validateQuestionBank(questions);
  if (errors.length > 0) throw new ValidationError(errors.join(' '));

  if (questionsPerSession > questions.length) {
    throw new ValidationError(
      `Questions per session (${questionsPerSession}) cannot exceed the bank size (${questions.length}).`,
    );
  }
}

// ─── GET /admin/games ─────────────────────────────────────────────────────────

adminGamesRouter.get('/', async (_req, res, next) => {
  try {
    const definitions = await prisma.gameDefinition.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      include: { _count: { select: { sessions: true } } },
    });

    // Completed-play counts, one grouped query rather than N per-definition ones.
    const completed = await prisma.gameSession.groupBy({
      by: ['gameDefinitionId'],
      where: { status: 'completed' },
      _count: { _all: true },
      _avg: { pointsAwarded: true },
    });
    const statsByGame = new Map(
      completed.map((row) => [
        row.gameDefinitionId,
        { plays: row._count._all, avgPoints: Math.round(row._avg.pointsAwarded ?? 0) },
      ]),
    );

    const games = definitions.map((def) => {
      const bank = (def.questionsJson as unknown as Question[]) ?? [];
      const stats = statsByGame.get(def.id);
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
        questionsPerSession: def.questionsPerSession,
        bankSize: bank.length,
        isActive: def.isActive,
        totalSessions: def._count.sessions,
        completedSessions: stats?.plays ?? 0,
        avgPointsAwarded: stats?.avgPoints ?? 0,
        // How many distinct daily draws the bank supports before a child sees a full repeat.
        // Surfaced so an admin can tell at a glance that a 5-question bank rotates nothing.
        rotationHealth: rotationHealth(bank.length, def.questionsPerSession),
        createdAt: def.createdAt,
        updatedAt: def.updatedAt,
      };
    });

    res.json({ success: true, data: { games } });
  } catch (error) {
    next(error);
  }
});

/**
 * A plain-language verdict on whether the bank is big enough for the daily draw to feel varied.
 * "none" is the state every seeded game was in before the banks were backfilled.
 */
function rotationHealth(bankSize: number, perSession: number): 'none' | 'low' | 'good' {
  if (bankSize <= perSession) return 'none';
  if (bankSize < perSession * 3) return 'low';
  return 'good';
}

// ─── GET /admin/games/:id ─────────────────────────────────────────────────────

adminGamesRouter.get('/:id', async (req, res, next) => {
  try {
    const def = await prisma.gameDefinition.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { sessions: true } } },
    });
    if (!def) throw new NotFoundError('Game not found');

    res.json({
      success: true,
      data: {
        game: {
          id: def.id,
          type: def.type,
          title: def.title,
          description: def.description,
          difficulty: def.difficulty,
          pointsReward: def.pointsReward,
          xpReward: def.xpReward,
          cooldownHours: def.cooldownHours,
          ageGroup: def.ageGroup,
          questionsPerSession: def.questionsPerSession,
          isActive: def.isActive,
          totalSessions: def._count.sessions,
          // Admin-only: correct answers included, because this is the authoring view.
          questions: def.questionsJson,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /admin/games ────────────────────────────────────────────────────────

adminGamesRouter.post('/', validateBody(gameBodySchema), async (req, res, next) => {
  try {
    const body = gameBodySchema.parse(req.body);
    assertBankConsistent(body.questions, body.questionsPerSession);

    const created = await prisma.gameDefinition.create({
      data: {
        type: body.type,
        title: body.title,
        description: body.description ?? null,
        difficulty: body.difficulty,
        pointsReward: body.pointsReward,
        xpReward: body.xpReward,
        cooldownHours: body.cooldownHours,
        ageGroup: body.ageGroup ?? null,
        questionsPerSession: body.questionsPerSession,
        questionsJson: body.questions as unknown as object[],
        isActive: body.isActive,
      },
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'game_definition',
      resourceId: created.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: { title: created.title, bankSize: body.questions.length },
    });

    res.status(201).json({ success: true, data: { game: created } });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /admin/games/:id ───────────────────────────────────────────────────

adminGamesRouter.patch('/:id', validateBody(gamePatchSchema), async (req, res, next) => {
  try {
    const body = gamePatchSchema.parse(req.body);
    const existing = await prisma.gameDefinition.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Game not found');

    // Validate the bank/draw pair as it will be AFTER the patch, not just the fields supplied —
    // raising questionsPerSession alone could otherwise exceed an untouched bank.
    const nextQuestions =
      body.questions ?? ((existing.questionsJson as unknown as Question[]) ?? []);
    const nextPerSession = body.questionsPerSession ?? existing.questionsPerSession;
    assertBankConsistent(nextQuestions, nextPerSession);

    const updated = await prisma.gameDefinition.update({
      where: { id: req.params.id },
      data: {
        ...(body.type !== undefined && { type: body.type }),
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description ?? null }),
        ...(body.difficulty !== undefined && { difficulty: body.difficulty }),
        ...(body.pointsReward !== undefined && { pointsReward: body.pointsReward }),
        ...(body.xpReward !== undefined && { xpReward: body.xpReward }),
        ...(body.cooldownHours !== undefined && { cooldownHours: body.cooldownHours }),
        ...(body.ageGroup !== undefined && { ageGroup: body.ageGroup ?? null }),
        ...(body.questionsPerSession !== undefined && {
          questionsPerSession: body.questionsPerSession,
        }),
        ...(body.questions !== undefined && {
          questionsJson: body.questions as unknown as object[],
        }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'game_definition',
      resourceId: updated.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: {
        title: updated.title,
        // Editing a bank is the change most worth being able to trace later.
        bankEdited: body.questions !== undefined,
        bankSize: nextQuestions.length,
      },
    });

    res.json({ success: true, data: { game: updated } });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /admin/games/:id ──────────────────────────────────────────────────

/**
 * Deactivate rather than delete once a game has been played: GameSession cascades on delete, so a
 * hard delete would erase play history that the points ledger still references by id. A game that
 * has never been played is safe to remove outright.
 */
adminGamesRouter.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.gameDefinition.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { sessions: true } } },
    });
    if (!existing) throw new NotFoundError('Game not found');

    const hasHistory = existing._count.sessions > 0;

    if (hasHistory) {
      await prisma.gameDefinition.update({
        where: { id: req.params.id },
        data: { isActive: false },
      });
    } else {
      await prisma.gameDefinition.delete({ where: { id: req.params.id } });
    }

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: hasHistory ? 'UPDATE' : 'DELETE',
      resourceType: 'game_definition',
      resourceId: req.params.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: {
        title: existing.title,
        mode: hasHistory ? 'deactivated' : 'deleted',
        sessions: existing._count.sessions,
      },
    });

    res.json({
      success: true,
      data: {
        mode: hasHistory ? 'deactivated' : 'deleted',
        message: hasHistory
          ? 'Game deactivated. Play history is preserved, so children no longer see it.'
          : 'Game deleted. It had never been played.',
      },
    });
  } catch (error) {
    next(error);
  }
});
