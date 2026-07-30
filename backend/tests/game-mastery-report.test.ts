/**
 * R-12 extensions: mastery, the avoidance signal, drill-down and bank coverage.
 *
 * The existing report counted plays and points. A parent cannot act on either. These sections exist to
 * answer "where is my child struggling", and the tests below guard the two ways that answer could be
 * quietly wrong:
 *
 *  - **Accuracy over questions, not games.** A child who scrapes 3 of 5 four times running is 60%
 *    accurate, not a 100% pass rate. Getting this wrong flatters every child and makes the report useless.
 *  - **The avoidance flag needs both halves.** Struggling alone is not avoidance, and playing something
 *    rarely is not a problem if they are good at it. Flagging on either alone produces noise a parent
 *    learns to ignore.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findMany: jest.fn() },
    gameDefinition: { findMany: jest.fn() },
    gameSession: { findMany: jest.fn() },
    familySettings: { findUnique: jest.fn() },
    gameQuestionSeen: { groupBy: jest.fn() },
  },
}));

import { getGamesReport } from '../src/services/ReportService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  user: { findMany: jest.Mock };
  gameDefinition: { findMany: jest.Mock };
  gameSession: { findMany: jest.Mock };
  familySettings: { findUnique: jest.Mock };
  gameQuestionSeen: { groupBy: jest.Mock };
};

const FAMILY = 'fam-1';
const ADA = 'child-ada';

/** Five questions; correct answers are 0,1,2,3,0. */
const BANK = [
  { id: 'q1', text: 'a?', options: ['A', 'B', 'C', 'D'], correctIndex: 0 },
  { id: 'q2', text: 'b?', options: ['A', 'B', 'C', 'D'], correctIndex: 1 },
  { id: 'q3', text: 'c?', options: ['A', 'B', 'C', 'D'], correctIndex: 2 },
  { id: 'q4', text: 'd?', options: ['A', 'B', 'C', 'D'], correctIndex: 3 },
  { id: 'q5', text: 'e?', options: ['A', 'B', 'C', 'D'], correctIndex: 0 },
];

function definition(id: string, category: string, level: string) {
  return { id, title: `${category} ${level}`, difficulty: 'easy', category, level, questionsJson: BANK };
}

/** A completed session with `correct` of 5 right. */
function session(id: string, defId: string, correct: number, childId = ADA) {
  const answers = BANK.map((q, i) => (i < correct ? q.correctIndex : (q.correctIndex + 1) % 4));
  return {
    id,
    gameDefinitionId: defId,
    childId,
    status: 'completed',
    pointsAwarded: 2,
    xpAwarded: 15,
    submittedAt: new Date('2026-07-30T10:00:00Z'),
    answersJson: answers,
    servedQuestionsJson: BANK,
  };
}

function setup(definitions: unknown[], sessions: unknown[], seen: unknown[] = []) {
  jest.clearAllMocks();
  p.user.findMany.mockResolvedValue([{ id: ADA, firstName: 'Ada', lastName: 'L' }]);
  p.gameDefinition.findMany.mockResolvedValue(definitions);
  p.gameSession.findMany.mockResolvedValue(sessions);
  p.familySettings.findUnique.mockResolvedValue({ maxGamePointsPerDay: 100 });
  p.gameQuestionSeen.groupBy.mockResolvedValue(seen);
}

describe('mastery', () => {
  it('measures accuracy over QUESTIONS, not over games passed', async () => {
    /**
     * The distinction the whole grid rests on. Four sessions at 3 of 5 is 60% accurate. A pass-rate
     * figure would call it 100% and tell a parent their child has mastered a subject they are scraping.
     */
    setup(
      [definition('d1', 'maths', 'beginner')],
      ['s1', 's2', 's3', 's4'].map((id) => session(id, 'd1', 3)),
    );

    const report = await getGamesReport({ familyId: FAMILY });
    const cell = report.mastery.find((m) => m.category === 'maths');

    expect(cell).toMatchObject({ plays: 4, questionsAnswered: 20, questionsCorrect: 12, accuracy: 60 });
  });

  it('reports never-played as null, never as 0%', async () => {
    // 0% would read as "gets everything wrong", which is the opposite of "has not tried it".
    setup([definition('d1', 'grammar', 'hard')], []);

    const report = await getGamesReport({ familyId: FAMILY });

    expect(report.mastery.find((m) => m.category === 'grammar')?.accuracy).toBeNull();
  });

  it('ignores unfinished sessions — an abandoned game says nothing about what they know', async () => {
    setup(
      [definition('d1', 'maths', 'beginner')],
      [{ ...session('s1', 'd1', 5), status: 'in_progress' }],
    );

    const report = await getGamesReport({ familyId: FAMILY });

    expect(report.mastery.find((m) => m.category === 'maths')?.plays).toBe(0);
  });

  it('emits a cell per level, so a child strong at beginner and weak at hard is visible', async () => {
    setup(
      [definition('d1', 'maths', 'beginner'), definition('d2', 'maths', 'hard')],
      [session('s1', 'd1', 5), session('s2', 'd2', 1)],
    );

    const report = await getGamesReport({ familyId: FAMILY });
    const maths = report.mastery.filter((m) => m.category === 'maths');

    expect(maths.find((m) => m.level === 'beginner')?.accuracy).toBe(100);
    expect(maths.find((m) => m.level === 'hard')?.accuracy).toBe(20);
  });
});

describe('the avoidance signal', () => {
  it('flags a subject that is BOTH avoided and struggled with', async () => {
    // Maths played 4×, grammar once at 20% — the case the report exists to surface.
    setup(
      [definition('d1', 'maths', 'beginner'), definition('d2', 'grammar', 'beginner')],
      [
        session('s1', 'd1', 5),
        session('s2', 'd1', 5),
        session('s3', 'd1', 5),
        session('s4', 'd1', 5),
        session('s5', 'd2', 1),
      ],
    );

    const report = await getGamesReport({ familyId: FAMILY });

    const grammar = report.avoidance.find((a) => a.category === 'grammar');
    expect(grammar?.needsAttention).toBe(true);
    expect(grammar?.reason).toContain('%');

    const maths = report.avoidance.find((a) => a.category === 'maths');
    expect(maths?.needsAttention).toBe(false);
  });

  it('does NOT flag a subject played rarely but done well', async () => {
    // Rarity alone is not a problem. Flagging it would train a parent to ignore the section.
    setup(
      [definition('d1', 'maths', 'beginner'), definition('d2', 'grammar', 'beginner')],
      [
        session('s1', 'd1', 5),
        session('s2', 'd1', 5),
        session('s3', 'd1', 5),
        session('s4', 'd1', 5),
        session('s5', 'd2', 5), // played once, but perfect
      ],
    );

    const report = await getGamesReport({ familyId: FAMILY });

    expect(report.avoidance.find((a) => a.category === 'grammar')?.needsAttention).toBe(false);
  });

  it('does NOT flag a subject struggled with but played just as much as the rest', async () => {
    // Struggling evenly across everything is a difficulty signal, not an avoidance one.
    setup(
      [definition('d1', 'maths', 'beginner'), definition('d2', 'grammar', 'beginner')],
      [session('s1', 'd1', 1), session('s2', 'd2', 1)],
    );

    const report = await getGamesReport({ familyId: FAMILY });

    expect(report.avoidance.find((a) => a.category === 'grammar')?.needsAttention).toBe(false);
  });

  it('flags a subject never touched while others are being played', async () => {
    setup(
      [definition('d1', 'maths', 'beginner'), definition('d2', 'puzzle', 'beginner')],
      [session('s1', 'd1', 5)],
    );

    const report = await getGamesReport({ familyId: FAMILY });
    const puzzle = report.avoidance.find((a) => a.category === 'puzzle');

    expect(puzzle?.needsAttention).toBe(true);
    expect(puzzle?.reason).toContain('Never played');
  });

  it('flags nothing for a child who has played nothing at all', async () => {
    // No baseline means no signal. Flagging every subject for a new child would be pure noise.
    setup([definition('d1', 'maths', 'beginner')], []);

    const report = await getGamesReport({ familyId: FAMILY });

    expect(report.avoidance.filter((a) => a.needsAttention)).toEqual([]);
  });
});

describe('drill-down and coverage', () => {
  it('lists finished games with the score recomputed from stored answers', async () => {
    setup([definition('d1', 'maths', 'beginner')], [session('s1', 'd1', 4)]);

    const report = await getGamesReport({ familyId: FAMILY });

    expect(report.recentSessions[0]).toMatchObject({
      sessionId: 's1',
      childName: 'Ada L',
      category: 'maths',
      correctCount: 4,
      totalQuestions: 5,
    });
  });

  it('reports bank coverage and marks an exhausted bank', async () => {
    /**
     * The answer to "why is my child seeing the same questions?" — at 100% the rotation has begun
     * recycling, by design. Without this the recycling looks like a bug.
     */
    setup(
      [definition('d1', 'maths', 'beginner')],
      [session('s1', 'd1', 5)],
      [{ childId: ADA, gameDefinitionId: 'd1', _count: { questionId: 5 } }],
    );

    const report = await getGamesReport({ familyId: FAMILY });

    expect(report.coverage[0]).toMatchObject({ seen: 5, bankSize: 5, coverage: 100, exhausted: true });
  });

  it('omits games the child has never opened', async () => {
    setup([definition('d1', 'maths', 'beginner')], [], []);

    const report = await getGamesReport({ familyId: FAMILY });

    expect(report.coverage).toEqual([]);
  });
});

describe('family scoping', () => {
  it('returns a fully-formed empty report without a familyId', async () => {
    // The export path reaches this too; an unscoped query would match every family's children.
    jest.clearAllMocks();

    const report = await getGamesReport({});

    expect(report.mastery).toEqual([]);
    expect(report.avoidance).toEqual([]);
    expect(report.recentSessions).toEqual([]);
    expect(report.coverage).toEqual([]);
    expect(p.user.findMany).not.toHaveBeenCalled();
  });
});
