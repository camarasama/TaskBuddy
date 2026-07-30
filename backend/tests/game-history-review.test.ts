/**
 * GET /games/history and /games/history/:id — reading back a finished game.
 *
 * The review data has been stored since per-question grading shipped (`servedQuestionsJson` +
 * `answersJson`) and `submit` already returned it once. Nothing could read it back afterwards, because
 * `loadPlayableSession()` refuses any session that is not `in_progress` — correct for play, fatal for a
 * review screen. These routes are the separate loader.
 *
 * The tests that earn their place are the access-control ones. This endpoint reveals correct answers, so
 * the two ways it could go wrong are serving another child's game and serving an UNFINISHED game — the
 * second would hand a child the answers to a quiz they are still being graded on.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    gameSession: { findMany: jest.fn(), findUnique: jest.fn() },
  },
}));

// The router mounts its own authenticate/requireChild, which would 401 every request here. Stubbed so
// the route logic is what is under test; identity is injected per-app below.
jest.mock('../src/middleware/auth', () => ({
  authenticate: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireChild: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireParent: (_q: unknown, _s: unknown, n: () => void) => n(),
  requireAuth: (_q: unknown, _s: unknown, n: () => void) => n(),
  familyIsolation: (_q: unknown, _s: unknown, n: () => void) => n(),
}));

import request from 'supertest';
import express from 'express';
import { prisma } from '../src/services/database';
import { errorHandler } from '../src/middleware/errorHandler';

const p = prisma as unknown as {
  gameSession: { findMany: jest.Mock; findUnique: jest.Mock };
};

const CHILD = 'child-1';
const OTHER_CHILD = 'child-2';

const QUESTIONS = [
  { id: 'm01', text: '7 x 8?', options: ['54', '56', '64', '48'], correctIndex: 1 },
  { id: 'm02', text: '144 / 12?', options: ['10', '11', '12', '13'], correctIndex: 2 },
];

const DEFINITION = {
  id: 'def-1',
  title: 'Math Challenge',
  category: 'maths',
  level: 'beginner',
  questionsJson: QUESTIONS,
};

function completedSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    childId: CHILD,
    gameDefinitionId: 'def-1',
    status: 'completed',
    submittedAt: new Date('2026-07-30T10:00:00Z'),
    pointsAwarded: 2,
    xpAwarded: 15,
    // First right, second wrong.
    answersJson: [1, 0],
    servedQuestionsJson: QUESTIONS,
    gameDefinition: DEFINITION,
    ...overrides,
  };
}

/** Mounts the real router with a fixed child identity, so the route logic is what is under test. */
function appAs(userId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { userId, role: 'child', familyId: 'fam-1' };
    next();
  });
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { gamesRouter } = require('../src/routes/games');
  app.use('/games', gamesRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /games/history', () => {
  it('returns finished games with the score derived from stored answers', async () => {
    p.gameSession.findMany.mockResolvedValue([completedSession()]);

    const res = await request(appAs(CHILD)).get('/games/history');

    expect(res.status).toBe(200);
    const [entry] = res.body.data.sessions;
    expect(entry.correctCount).toBe(1);
    expect(entry.totalQuestions).toBe(2);
    expect(entry.pointsAwarded).toBe(2);
    expect(entry.game).toMatchObject({ category: 'maths', level: 'beginner' });
  });

  it('never returns correct answers in the list', async () => {
    /**
     * The list is a summary. Leaking `correctIndex` here would let a child read the answers to a game
     * they are about to replay after the cooldown — greps the whole payload rather than named fields, so
     * a future addition cannot slip past.
     */
    p.gameSession.findMany.mockResolvedValue([completedSession()]);

    const res = await request(appAs(CHILD)).get('/games/history');

    expect(JSON.stringify(res.body)).not.toContain('correctIndex');
  });

  it('scopes the query to the calling child and to finished games only', async () => {
    p.gameSession.findMany.mockResolvedValue([]);

    await request(appAs(CHILD)).get('/games/history');

    const where = p.gameSession.findMany.mock.calls[0][0].where;
    expect(where.childId).toBe(CHILD);
    expect(where.status).toBe('completed');
  });

  it('clamps the limit so a caller cannot ask for everything', async () => {
    p.gameSession.findMany.mockResolvedValue([]);

    await request(appAs(CHILD)).get('/games/history?limit=9999');
    expect(p.gameSession.findMany.mock.calls[0][0].take).toBe(50);

    p.gameSession.findMany.mockClear();
    await request(appAs(CHILD)).get('/games/history?limit=0');
    expect(p.gameSession.findMany.mock.calls[0][0].take).toBe(20);
  });
});

describe('GET /games/history/:id', () => {
  it('returns the per-question review with the correct answers revealed', async () => {
    p.gameSession.findUnique.mockResolvedValue(completedSession());

    const res = await request(appAs(CHILD)).get('/games/history/sess-1');

    expect(res.status).toBe(200);
    expect(res.body.data.review).toHaveLength(2);
    expect(res.body.data.review[0].correct).toBe(true);
    expect(res.body.data.review[1].correct).toBe(false);
    // Revealing these is the point of the screen — safe because the session is closed.
    expect(res.body.data.review[0]).toHaveProperty('correctIndex');
  });

  it('reports the chosen and correct options in the order the child actually saw', async () => {
    // Options are permuted from the session id, so a review that used stored order would highlight the
    // wrong row even while reporting the right verdict.
    p.gameSession.findUnique.mockResolvedValue(completedSession());

    const res = await request(appAs(CHILD)).get('/games/history/sess-1');
    const [first] = res.body.data.review;

    expect(first.options[first.correctIndex]).toBe('56');
    expect(first.options[first.chosenIndex]).toBe('56');
  });

  it("refuses another child's game", async () => {
    p.gameSession.findUnique.mockResolvedValue(completedSession({ childId: OTHER_CHILD }));

    const res = await request(appAs(CHILD)).get('/games/history/sess-1');

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('correctIndex');
  });

  it('refuses an UNFINISHED game — otherwise it hands over live answers', async () => {
    /**
     * The dangerous case. A child mid-quiz could otherwise call this endpoint and read every correct
     * answer before committing, which is exactly what the answer-locking flow exists to prevent.
     */
    p.gameSession.findUnique.mockResolvedValue(completedSession({ status: 'in_progress' }));

    const res = await request(appAs(CHILD)).get('/games/history/sess-1');

    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain('correctIndex');
  });

  it('checks ownership before status, so ids cannot be probed', async () => {
    // If status were checked first, "not yours" and "not finished" would return different codes and
    // reveal whether another child's session exists and how far along it is.
    p.gameSession.findUnique.mockResolvedValue(
      completedSession({ childId: OTHER_CHILD, status: 'in_progress' }),
    );

    const res = await request(appAs(CHILD)).get('/games/history/sess-1');

    expect(res.status).toBe(403);
  });

  it('404s an unknown id', async () => {
    p.gameSession.findUnique.mockResolvedValue(null);

    const res = await request(appAs(CHILD)).get('/games/history/nope');

    expect(res.status).toBe(404);
  });
});
