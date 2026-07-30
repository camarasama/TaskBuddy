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
import { validateQuestionBank } from '../src/services/GameService';

const BANKS: Array<[string, SeedQuestion[]]> = [
  ['maths / beginner', MATHS_BEGINNER],
  ['maths / intermediate', MATHS_INTERMEDIATE],
  ['maths / hard', MATHS_HARD],
];

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

describe('across the maths banks', () => {
  /**
   * Pairwise across ALL THREE levels, and this is the test that matters most in the file.
   *
   * Beginner originally lived inline in `gamesSeed.ts` while the other two lived here, so this check
   * could only see two of the three banks — and it passed while two questions were duplicated verbatim
   * between beginner and intermediate, and two more were the same question reworded. Consolidating the
   * content into one file is what made the check possible; without it the bug was structurally invisible.
   *
   * A duplicate across levels is not cosmetic: it undermines the tiering the levels exist to express, and
   * a child meeting the same question at two difficulties concludes the app is broken.
   */
  const PAIRS: Array<[string, SeedQuestion[], string, SeedQuestion[]]> = [
    ['beginner', MATHS_BEGINNER, 'intermediate', MATHS_INTERMEDIATE],
    ['beginner', MATHS_BEGINNER, 'hard', MATHS_HARD],
    ['intermediate', MATHS_INTERMEDIATE, 'hard', MATHS_HARD],
  ];

  // Looped rather than `it.each`: a tuple containing arrays renders as "beginner and [" in the output,
  // and a test whose name does not say what it covers is a test nobody can act on when it fails.
  for (const [nameA, bankA, nameB, bankB] of PAIRS) {
    it(`${nameA} and ${nameB} share no question ids`, () => {
      // Ids are unique per definition in the schema, but overlapping ids across banks make debugging a
      // rotation problem far harder than it needs to be.
      const ids = new Set(bankA.map((q) => q.id));
      expect(bankB.filter((q) => ids.has(q.id)).map((q) => q.id)).toEqual([]);
    });

    it(`${nameA} and ${nameB} repeat no question text`, () => {
      const texts = new Set(bankA.map((q) => q.text.trim().toLowerCase()));
      expect(bankB.filter((q) => texts.has(q.text.trim().toLowerCase())).map((q) => q.id)).toEqual([]);
    });
  }

  it('has no repeated question anywhere across the whole category', () => {
    // The catch-all: whatever the pairings, one question text may exist once in the category.
    const all = [...MATHS_BEGINNER, ...MATHS_INTERMEDIATE, ...MATHS_HARD];
    const texts = all.map((q) => q.text.trim().toLowerCase());
    expect(texts).toHaveLength(new Set(texts).size);
  });
});
