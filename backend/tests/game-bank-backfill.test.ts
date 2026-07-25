/**
 * backfillGameBanks - grows the seeded games to their full banks on an existing deployment.
 *
 * The subtle case, and the reason this file exists: the shipped seed used ids `q1`-`q5` for EVERY
 * game, while the banks use per-topic ids (m01, s01, g01...). An id-only comparison therefore finds
 * no overlap and appends all 25, leaving the original five present TWICE under two different ids.
 * `selectDailyQuestions` treats those as distinct entries, so a single quiz could ask the same
 * question twice. Matching on question text as well is what prevents that.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    gameDefinition: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
  },
}));

import { backfillGameBanks } from '../src/routes/gamesSeed';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  gameDefinition: { findFirst: jest.Mock; update: jest.Mock; create: jest.Mock };
};

interface Q {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/** The exact pre-PR state of a deployed Math Challenge: 5 questions under legacy ids. */
const LEGACY_MATH: Q[] = [
  { id: 'q1', text: 'What is 7 × 8?', options: ['54', '56', '64', '48'], correctIndex: 1 },
  { id: 'q2', text: 'What is 144 ÷ 12?', options: ['10', '11', '12', '13'], correctIndex: 2 },
  { id: 'q3', text: 'What is 15% of 200?', options: ['25', '30', '35', '40'], correctIndex: 1 },
  { id: 'q4', text: 'What is 2³?', options: ['6', '8', '9', '16'], correctIndex: 1 },
  { id: 'q5', text: 'What is the square root of 81?', options: ['7', '8', '9', '10'], correctIndex: 2 },
];

/** Capture what the backfill wrote for a given game title. */
function writtenBank(title: string): Q[] | undefined {
  const call = p.gameDefinition.update.mock.calls.find(
    (c) => c[0]?.where?.id === `id-${title}`,
  );
  return call?.[0]?.data?.questionsJson as Q[] | undefined;
}

describe('backfillGameBanks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    p.gameDefinition.update.mockResolvedValue({});
  });

  describe('against a real pre-deploy deployment (legacy q1-q5 ids)', () => {
    beforeEach(() => {
      p.gameDefinition.findFirst.mockImplementation(({ where }: { where: { title: string } }) =>
        Promise.resolve({
          id: `id-${where.title}`,
          title: where.title,
          questionsJson: where.title === 'Math Challenge' ? LEGACY_MATH : [],
        }),
      );
    });

    it('grows the bank to exactly 25, not 30', async () => {
      await backfillGameBanks();
      expect(writtenBank('Math Challenge')).toHaveLength(25);
    });

    it('introduces no duplicate question text', async () => {
      await backfillGameBanks();
      const texts = writtenBank('Math Challenge')!.map((q) => q.text.trim().toLowerCase());
      expect(new Set(texts).size).toBe(texts.length);
    });

    it('introduces no duplicate ids', async () => {
      await backfillGameBanks();
      const ids = writtenBank('Math Challenge')!.map((q) => q.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('preserves the existing rows untouched, ids included', async () => {
      // Rewriting them would orphan any per-question stats keyed on the old ids.
      await backfillGameBanks();
      expect(writtenBank('Math Challenge')!.slice(0, 5)).toEqual(LEGACY_MATH);
    });
  });

  it('is idempotent - a bank completed by a previous run is left alone', async () => {
    // First pass over a legacy deployment.
    p.gameDefinition.findFirst.mockImplementation(({ where }: { where: { title: string } }) =>
      Promise.resolve({
        id: `id-${where.title}`,
        title: where.title,
        questionsJson: where.title === 'Math Challenge' ? LEGACY_MATH : [],
      }),
    );
    await backfillGameBanks();
    const firstPass = writtenBank('Math Challenge')!;

    // Second pass: feed Math Challenge back what the first pass wrote. Scoped to that one game -
    // the other two are irrelevant here and asserting globally would just re-test the first pass.
    jest.clearAllMocks();
    p.gameDefinition.update.mockResolvedValue({});
    p.gameDefinition.findFirst.mockImplementation(({ where }: { where: { title: string } }) =>
      Promise.resolve(
        where.title === 'Math Challenge'
          ? { id: 'id-Math Challenge', title: where.title, questionsJson: firstPass }
          : null,
      ),
    );

    await backfillGameBanks();
    expect(writtenBank('Math Challenge')).toBeUndefined();
  });

  it('matches text case-insensitively and ignores whitespace differences', async () => {
    p.gameDefinition.findFirst.mockResolvedValue({
      id: 'id-Math Challenge',
      title: 'Math Challenge',
      questionsJson: [
        { id: 'legacy', text: '  what is 7 × 8?  ', options: ['54', '56'], correctIndex: 1 },
      ],
    });

    await backfillGameBanks();
    const bank = writtenBank('Math Challenge')!;
    const matches = bank.filter((q) => q.text.trim().toLowerCase().includes('7 × 8'));
    expect(matches).toHaveLength(1);
  });

  it('skips definitions that do not exist rather than creating them', async () => {
    // seedGames owns creation; this only tops up what is already deployed.
    p.gameDefinition.findFirst.mockResolvedValue(null);
    await backfillGameBanks();
    expect(p.gameDefinition.update).not.toHaveBeenCalled();
    expect(p.gameDefinition.create).not.toHaveBeenCalled();
  });

  it('tolerates a row whose questionsJson is null', async () => {
    p.gameDefinition.findFirst.mockResolvedValue({
      id: 'id-Math Challenge',
      title: 'Math Challenge',
      questionsJson: null,
    });
    await expect(backfillGameBanks()).resolves.not.toThrow();
    expect(writtenBank('Math Challenge')).toHaveLength(25);
  });
});
