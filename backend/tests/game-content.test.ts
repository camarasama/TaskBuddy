/**
 * Structural validation of the authored maths banks.
 *
 * This cannot check that "15% of 200 is 30" — only a human can. What it CAN check is the class of error
 * that is invisible in review and fatal in play: a `correctIndex` pointing outside the options array
 * makes a question impossible to answer correctly, and grading would silently never award it. A
 * duplicated id makes two questions collide in the rotation index, so one of them is never served again
 * after the other is seen.
 *
 * Run against every authored bank, so adding the remaining five categories inherits these checks for free.
 */

import {
  MATHS_BEGINNER,
  MATHS_HARD,
  MATHS_INTERMEDIATE,
  type SeedQuestion,
} from '../src/content/games/maths';
import {
  SCIENCE_BEGINNER,
  SCIENCE_HARD,
  SCIENCE_INTERMEDIATE,
} from '../src/content/games/science';
import {
  GEOGRAPHY_BEGINNER,
  GEOGRAPHY_HARD,
  GEOGRAPHY_INTERMEDIATE,
} from '../src/content/games/geography';
import { validateQuestionBank } from '../src/services/GameService';

/**
 * Every authored category, keyed by name. Adding a category here is all that is needed for it to inherit
 * the whole suite — which is the point of one file per category.
 */
const CATEGORIES: Record<string, Record<string, SeedQuestion[]>> = {
  maths: { beginner: MATHS_BEGINNER, intermediate: MATHS_INTERMEDIATE, hard: MATHS_HARD },
  science: { beginner: SCIENCE_BEGINNER, intermediate: SCIENCE_INTERMEDIATE, hard: SCIENCE_HARD },
  geography: {
    beginner: GEOGRAPHY_BEGINNER,
    intermediate: GEOGRAPHY_INTERMEDIATE,
    hard: GEOGRAPHY_HARD,
  },
};

const BANKS: Array<[string, SeedQuestion[]]> = Object.entries(CATEGORIES).flatMap(
  ([category, levels]) =>
    Object.entries(levels).map(
      ([level, bank]) => [`${category} / ${level}`, bank] as [string, SeedQuestion[]],
    ),
);

describe.each(BANKS)('%s bank', (_name, bank) => {
  it('passes the same validation the admin editor enforces', () => {
    // Reuses the production validator rather than reimplementing it, so authored content and
    // admin-authored content are held to one standard.
    expect(validateQuestionBank(bank)).toEqual([]);
  });

  it('has a correctIndex inside its own options array', () => {
    // The failure this file exists for: an out-of-range index is unanswerable and grades as always wrong.
    const broken = bank.filter((q) => q.correctIndex < 0 || q.correctIndex >= q.options.length);
    expect(broken.map((q) => q.id)).toEqual([]);
  });

  it('has unique ids', () => {
    // Duplicate ids collide in GameQuestionSeen's unique key, so seeing one would retire both.
    const ids = bank.map((q) => q.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it('has unique question text', () => {
    // Two phrasings of the same question feel like a bug to a child who meets both in one draw.
    const texts = bank.map((q) => q.text.trim().toLowerCase());
    expect(texts).toHaveLength(new Set(texts).size);
  });

  it('offers four distinct options for every question', () => {
    const bad = bank.filter(
      (q) => q.options.length !== 4 || new Set(q.options.map((o) => o.trim())).size !== 4,
    );
    expect(bad.map((q) => q.id)).toEqual([]);
  });

  it('has no blank text or options', () => {
    const bad = bank.filter(
      (q) => q.text.trim() === '' || q.options.some((o) => o.trim() === ''),
    );
    expect(bad.map((q) => q.id)).toEqual([]);
  });

  it('is big enough to rotate rather than repeat immediately', () => {
    /**
     * A session draws 5. At 20 questions a child gets four distinct plays before the bank recycles, which
     * is the floor worth shipping — below that the "it never changes" complaint returns.
     */
    expect(bank.length).toBeGreaterThanOrEqual(20);
  });

  it('does not put the answer in the same position every time', () => {
    /**
     * Options are shuffled per session from the session id, so position bias does not reach a child
     * today. This guards the bank itself: if that shuffle were ever removed or bypassed, a bank whose
     * answer is always B becomes trivially guessable.
     */
    const positions = new Set(bank.map((q) => q.correctIndex));
    expect(positions.size).toBeGreaterThanOrEqual(3);
  });
});

describe.each(Object.entries(CATEGORIES))('across the %s banks', (_category, levels) => {
  /**
   * Pairwise across all three levels, and the most valuable check in the file.
   *
   * Maths originally had beginner inline in `gamesSeed.ts` while the other two lived in a content file, so
   * this check could only see two of the three banks — and it passed while two questions were duplicated
   * verbatim and two more were the same question reworded. One file per category is what makes the check
   * possible at all.
   *
   * A duplicate across levels is not cosmetic: it undermines the tiering the levels exist to express, and
   * a child meeting the same question at two difficulties concludes the app is broken.
   */
  const names = Object.keys(levels);
  const PAIRS: Array<[string, string]> = [
    [names[0], names[1]],
    [names[0], names[2]],
    [names[1], names[2]],
  ];

  // Looped rather than `it.each`: a tuple containing arrays renders as "beginner and [" in the output,
  // and a test whose name does not say what it covers is useless when it fails.
  for (const [a, b] of PAIRS) {
    it(`${a} and ${b} share no question ids`, () => {
      const ids = new Set(levels[a].map((q) => q.id));
      expect(levels[b].filter((q) => ids.has(q.id)).map((q) => q.id)).toEqual([]);
    });

    it(`${a} and ${b} repeat no question text`, () => {
      const texts = new Set(levels[a].map((q) => q.text.trim().toLowerCase()));
      expect(levels[b].filter((q) => texts.has(q.text.trim().toLowerCase())).map((q) => q.id)).toEqual(
        [],
      );
    });
  }

  it('repeats no question anywhere in the category', () => {
    const all = Object.values(levels).flat();
    const texts = all.map((q) => q.text.trim().toLowerCase());
    expect(texts).toHaveLength(new Set(texts).size);
  });

  it('uses ids unique across the whole category', () => {
    const ids = Object.values(levels).flat().map((q) => q.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });
});
