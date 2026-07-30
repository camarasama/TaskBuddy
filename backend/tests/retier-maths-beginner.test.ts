/**
 * The one-off that re-tiers "Math Challenge" into a genuine beginner bank.
 *
 * The interesting half is not the content swap — it is the stale rotation rows.
 *
 * `coverage` in the games report counts `GameQuestionSeen` rows per (child, definition) against the bank
 * size. A child who had seen all 25 old questions would otherwise show 25/30 against the new bank and be
 * reported as nearly exhausted, when in truth they have seen none of the new material. Rotation itself
 * tolerates stale ids because it intersects the bank with what was seen — so this is a reporting bug that
 * is invisible until a parent reads a number and believes it.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    gameDefinition: { findFirst: jest.fn(), update: jest.fn() },
    gameQuestionSeen: { deleteMany: jest.fn() },
    $disconnect: jest.fn(),
  },
}));

import { retierMathsBeginner } from '../src/scripts/retier-maths-beginner';
import { MATHS_BEGINNER } from '../src/content/games/maths';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  gameDefinition: { findFirst: jest.Mock; update: jest.Mock };
  gameQuestionSeen: { deleteMany: jest.Mock };
};

/** The bank as it exists on a deployment that predates the re-tier. */
const OLD_BANK = [
  { id: 'm01', text: 'What is 7 × 8?' },
  { id: 'm03', text: 'What is 15% of 200?' },
  { id: 'm04', text: 'What is 2³?' },
  { id: 'm05', text: 'What is the square root of 81?' },
  { id: 'm14', text: 'What is 7 + 8 × 2?' },
  { id: 'm24', text: 'What is 5² − 5?' },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  p.gameQuestionSeen.deleteMany.mockResolvedValue({ count: 0 });
});

afterEach(() => jest.restoreAllMocks());

describe('retierMathsBeginner', () => {
  it('replaces the bank with the re-tiered beginner content', async () => {
    p.gameDefinition.findFirst.mockResolvedValue({ id: 'def-1', questionsJson: OLD_BANK });

    await retierMathsBeginner();

    const data = p.gameDefinition.update.mock.calls[0][0].data;
    expect(data.questionsJson).toHaveLength(MATHS_BEGINNER.length);
    expect((data.questionsJson as { id: string }[]).map((q) => q.id)).toEqual(
      MATHS_BEGINNER.map((q) => q.id),
    );
  });

  it('deletes rotation rows ONLY for questions the new bank no longer contains', async () => {
    /**
     * The assertion the script exists for. Without it, a child's coverage is measured against ids that
     * are gone and the report calls a fresh bank exhausted.
     */
    p.gameDefinition.findFirst.mockResolvedValue({ id: 'def-1', questionsJson: OLD_BANK });

    await retierMathsBeginner();

    const where = p.gameQuestionSeen.deleteMany.mock.calls[0][0].where;
    expect(where.questionId.notIn).toEqual(MATHS_BEGINNER.map((q) => q.id));
    // m01 survives the re-tier, so a child's history for it must NOT be deleted.
    expect(where.questionId.notIn).toContain('m01');
  });

  it('scopes the delete to this definition', async () => {
    // A question id is only unique within its own bank. An unscoped delete would wipe a child's history
    // for an identically-named question in a different game.
    p.gameDefinition.findFirst.mockResolvedValue({ id: 'def-1', questionsJson: OLD_BANK });

    await retierMathsBeginner();

    expect(p.gameQuestionSeen.deleteMany.mock.calls[0][0].where.gameDefinitionId).toBe('def-1');
  });

  it('keeps the retained questions at their original ids, so history survives', async () => {
    /**
     * Twenty of the original twenty-five keep their ids AND text. That is what makes this a re-tier
     * rather than a reset: those children keep their rotation position and only the five retired
     * questions are forgotten.
     */
    const retained = MATHS_BEGINNER.filter((q) => q.id.startsWith('m') && !q.id.startsWith('mb'));

    expect(retained.length).toBe(20);
    expect(retained.map((q) => q.id)).toContain('m01');
    // The five that belonged at intermediate are gone.
    for (const gone of ['m03', 'm04', 'm05', 'm14', 'm24']) {
      expect(MATHS_BEGINNER.map((q) => q.id)).not.toContain(gone);
    }
  });

  it('does nothing when the definition is absent, rather than failing a deploy', async () => {
    // A fresh install seeds the re-tiered bank directly. Not finding the row is expected, not an error.
    p.gameDefinition.findFirst.mockResolvedValue(null);

    await expect(retierMathsBeginner()).resolves.toBeUndefined();

    expect(p.gameDefinition.update).not.toHaveBeenCalled();
    expect(p.gameQuestionSeen.deleteMany).not.toHaveBeenCalled();
  });

  it('is idempotent — a second run finds nothing stale', async () => {
    // Re-running writes identical content, and every id is now in the bank so nothing matches notIn.
    p.gameDefinition.findFirst.mockResolvedValue({ id: 'def-1', questionsJson: MATHS_BEGINNER });

    await retierMathsBeginner();

    const where = p.gameQuestionSeen.deleteMany.mock.calls[0][0].where;
    const stale = MATHS_BEGINNER.map((q) => q.id).filter((id) => !where.questionId.notIn.includes(id));
    expect(stale).toEqual([]);
  });

  it('tolerates a definition whose bank is missing or malformed', async () => {
    // An admin could have emptied it; the script must still install the new bank rather than throw.
    p.gameDefinition.findFirst.mockResolvedValue({ id: 'def-1', questionsJson: null });

    await expect(retierMathsBeginner()).resolves.toBeUndefined();

    expect(p.gameDefinition.update).toHaveBeenCalled();
  });
});
