/**
 * Per-child question rotation.
 *
 * Replaces the date-seeded daily draw (`selectDailyQuestions`, still tested in game-rotation.test.ts for
 * the sessions created under it). The owner's requirement was "what has been solved should not show
 * again", scoped per child.
 *
 * Two properties carry the whole design and neither is obvious from reading the function:
 *
 *  1. **A child never sees a question twice while unseen ones remain.** That is the feature.
 *  2. **The bank can never dead-end them.** A 25-question bank drawn 5 at a time is five plays, and no
 *     authoring rate stays ahead of a keen child forever. Locking the category at that point would look
 *     like a broken app, so it recycles least-recently-seen instead.
 */

import { Question, SeenQuestion, selectQuestionsForChild } from '../src/services/GameService';

const BANK: Question[] = Array.from({ length: 25 }, (_, i) => ({
  id: `q${String(i + 1).padStart(2, '0')}`,
  text: `Question ${i + 1}?`,
  options: ['a', 'b', 'c', 'd'],
  correctIndex: i % 4,
}));

const SEED = 'child-1:game-1:fixed';

/** `n` questions marked seen, oldest first — q01 longest ago. */
function seenFirst(n: number): SeenQuestion[] {
  return BANK.slice(0, n).map((q, i) => ({
    questionId: q.id,
    seenAt: new Date(2026, 0, 1 + i),
  }));
}

describe('while unseen questions remain', () => {
  it('never serves one the child has already been graded on', () => {
    const seen = seenFirst(10);
    const seenIds = new Set(seen.map((s) => s.questionId));

    const drawn = selectQuestionsForChild(BANK, 5, seen, SEED);

    expect(drawn).toHaveLength(5);
    expect(drawn.filter((q) => seenIds.has(q.id))).toEqual([]);
  });

  it('serves nothing but unseen questions across a whole bank, then exactly repeats none', () => {
    /**
     * Walks a child through the entire bank five at a time, feeding each draw back in as seen. Every
     * question must appear exactly once — this is the assertion that would have caught the old bug where
     * `selectDailyQuestions` could serve the same question on different days.
     */
    let seen: SeenQuestion[] = [];
    const served: string[] = [];

    for (let play = 0; play < 5; play++) {
      const drawn = selectQuestionsForChild(BANK, 5, seen, `${SEED}:${play}`);
      served.push(...drawn.map((q) => q.id));
      seen = [
        ...seen,
        ...drawn.map((q) => ({ questionId: q.id, seenAt: new Date(2026, 1, play + 1) })),
      ];
    }

    expect(served).toHaveLength(25);
    expect(new Set(served).size).toBe(25);
  });

  it('varies the order between plays of the same unseen pool', () => {
    // Different seeds must not produce an identical draw, or "it never changes" comes straight back.
    const a = selectQuestionsForChild(BANK, 5, [], 'seed-a').map((q) => q.id);
    const b = selectQuestionsForChild(BANK, 5, [], 'seed-b').map((q) => q.id);
    expect(a).not.toEqual(b);
  });

  it('is deterministic for a given seed, so a draw is reproducible', () => {
    const a = selectQuestionsForChild(BANK, 5, [], SEED).map((q) => q.id);
    const b = selectQuestionsForChild(BANK, 5, [], SEED).map((q) => q.id);
    expect(a).toEqual(b);
  });
});

describe('when the bank is exhausted', () => {
  it('recycles rather than returning nothing', () => {
    // The dead-end case. Returning [] here would surface as "this game has no questions yet".
    const allSeen = seenFirst(25);

    const drawn = selectQuestionsForChild(BANK, 5, allSeen, SEED);

    expect(drawn).toHaveLength(5);
  });

  it('recycles the least-recently-seen first', () => {
    // q01 was seen longest ago, q25 most recently, so a 5-draw must be q01..q05.
    const allSeen = seenFirst(25);

    const drawn = selectQuestionsForChild(BANK, 5, allSeen, SEED).map((q) => q.id);

    expect(drawn).toEqual(['q01', 'q02', 'q03', 'q04', 'q05']);
  });

  it('prefers the last few unseen questions before recycling any', () => {
    /**
     * The partial case: 23 of 25 seen, so a 5-draw must include both remaining unseen questions and top
     * up with the 3 oldest. Serving a recycled question while an unseen one existed would be the bug.
     */
    const seen = seenFirst(23);

    const drawn = selectQuestionsForChild(BANK, 5, seen, SEED).map((q) => q.id);

    expect(drawn).toHaveLength(5);
    expect(drawn).toContain('q24');
    expect(drawn).toContain('q25');
    expect(drawn).toContain('q01'); // oldest seen, first to recycle
  });
});

describe('edge cases', () => {
  it('returns an empty draw for an empty bank rather than throwing', () => {
    expect(selectQuestionsForChild([], 5, [], SEED)).toEqual([]);
  });

  it('serves the whole bank when it is smaller than the requested count', () => {
    const small = BANK.slice(0, 3);
    expect(selectQuestionsForChild(small, 5, [], SEED)).toHaveLength(3);
  });

  it('ignores seen entries for questions no longer in the bank', () => {
    // An admin deleting a question must not shrink or corrupt a draw.
    const stale: SeenQuestion[] = [{ questionId: 'deleted-question', seenAt: new Date(2020, 0, 1) }];

    const drawn = selectQuestionsForChild(BANK, 5, stale, SEED);

    expect(drawn).toHaveLength(5);
    expect(drawn.map((q) => q.id)).not.toContain('deleted-question');
  });

  it('treats each child independently', () => {
    /**
     * Per-child scope, stated as a test. One child having exhausted the bank must not affect another —
     * this is the difference between the chosen design and the "solved by anyone" alternative.
     */
    const childA = selectQuestionsForChild(BANK, 5, seenFirst(25), SEED);
    const childB = selectQuestionsForChild(BANK, 5, [], SEED);

    // A is recycling; B still has a full unseen bank.
    expect(childA.map((q) => q.id)).toEqual(['q01', 'q02', 'q03', 'q04', 'q05']);
    expect(new Set(childB.map((q) => q.id)).size).toBe(5);
  });
});
