/**
 * Daily question rotation, bank validation, and the age gate.
 *
 * Rotation is the fix for the second reported bug — "the game does not change from one day to
 * another". The draw is seeded by game + UTC date so that siblings playing the same day get an
 * identical quiz (fair) while tomorrow's differs (varied), and these pin both halves.
 *
 * The bank-validation tests guard the admin editor: an out-of-range correctIndex would make a
 * question impossible to answer correctly, and grading would silently never award it.
 */

import {
  Question,
  ageInYears,
  isAgeAppropriate,
  resolveSessionQuestions,
  selectDailyQuestions,
  toDateKey,
  validateQuestionBank,
} from '../src/services/GameService';

/** A 25-entry bank standing in for a real seeded game. */
const BANK: Question[] = Array.from({ length: 25 }, (_, i) => ({
  id: `q${String(i + 1).padStart(2, '0')}`,
  text: `Question ${i + 1}?`,
  options: ['a', 'b', 'c', 'd'],
  correctIndex: i % 4,
}));

const GAME_ID = 'game-math-001';
const DAY_1 = new Date('2026-07-25T09:00:00.000Z');
const DAY_2 = new Date('2026-07-26T09:00:00.000Z');

describe('date keys', () => {
  it('keys by UTC calendar day', () => {
    expect(toDateKey(new Date('2026-07-25T00:00:00.000Z'))).toBe('2026-07-25');
    expect(toDateKey(new Date('2026-07-25T23:59:59.000Z'))).toBe('2026-07-25');
  });

  it('rolls over at UTC midnight', () => {
    expect(toDateKey(new Date('2026-07-26T00:00:00.000Z'))).toBe('2026-07-26');
  });
});

describe('daily draw', () => {
  it('serves the requested number of questions', () => {
    expect(selectDailyQuestions(BANK, 5, GAME_ID, DAY_1)).toHaveLength(5);
  });

  it('serves the SAME set all day, so siblings get the same quiz', () => {
    const morning = selectDailyQuestions(BANK, 5, GAME_ID, new Date('2026-07-25T07:00:00Z'));
    const evening = selectDailyQuestions(BANK, 5, GAME_ID, new Date('2026-07-25T20:00:00Z'));
    expect(morning.map((q) => q.id)).toEqual(evening.map((q) => q.id));
  });

  it('serves a DIFFERENT set the next day - the reported bug', () => {
    const today = selectDailyQuestions(BANK, 5, GAME_ID, DAY_1).map((q) => q.id);
    const tomorrow = selectDailyQuestions(BANK, 5, GAME_ID, DAY_2).map((q) => q.id);
    expect(today).not.toEqual(tomorrow);
  });

  it('differs between games on the same day', () => {
    const a = selectDailyQuestions(BANK, 5, 'game-a', DAY_1).map((q) => q.id);
    const b = selectDailyQuestions(BANK, 5, 'game-b', DAY_1).map((q) => q.id);
    expect(a).not.toEqual(b);
  });

  it('never repeats a question within one draw', () => {
    const ids = selectDailyQuestions(BANK, 5, GAME_ID, DAY_1).map((q) => q.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('only ever returns questions that are in the bank', () => {
    const bankIds = new Set(BANK.map((q) => q.id));
    for (let d = 0; d < 30; d++) {
      const day = new Date(Date.UTC(2026, 6, 1 + d));
      selectDailyQuestions(BANK, 5, GAME_ID, day).forEach((q) => {
        expect(bankIds.has(q.id)).toBe(true);
      });
    }
  });

  it('gives real variety across a month rather than cycling two sets', () => {
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) {
      const day = new Date(Date.UTC(2026, 6, 1 + d));
      seen.add(
        selectDailyQuestions(BANK, 5, GAME_ID, day)
          .map((q) => q.id)
          .sort()
          .join(','),
      );
    }
    // Distinct draws on most days; the exact count depends on the hash, so assert a floor.
    expect(seen.size).toBeGreaterThan(20);
  });

  it('degrades to the whole bank when it is smaller than the draw', () => {
    // This is the pre-backfill state: a 5-question bank drawing 5 has nothing to rotate, and must
    // keep working rather than erroring.
    const small = BANK.slice(0, 5);
    const drawn = selectDailyQuestions(small, 5, GAME_ID, DAY_1);
    expect(drawn).toHaveLength(5);
    expect(selectDailyQuestions(small, 10, GAME_ID, DAY_1)).toHaveLength(5);
  });

  it('returns an empty array for an empty or invalid bank instead of throwing', () => {
    expect(selectDailyQuestions([], 5, GAME_ID, DAY_1)).toEqual([]);
    expect(selectDailyQuestions(undefined as unknown as Question[], 5, GAME_ID, DAY_1)).toEqual([]);
  });
});

describe('session question snapshot', () => {
  it('prefers the session snapshot over the live bank', () => {
    // The point of the snapshot: an admin editing the bank mid-session must not change what this
    // session is graded against, or answersJson would misalign.
    const snapshot = BANK.slice(0, 3);
    const editedBank = BANK.slice(10, 20);
    expect(resolveSessionQuestions(snapshot, editedBank)).toEqual(snapshot);
  });

  it('falls back to the bank for sessions created before rotation existed', () => {
    expect(resolveSessionQuestions(null, BANK)).toEqual(BANK);
    expect(resolveSessionQuestions([], BANK)).toEqual(BANK);
  });
});

describe('question bank validation', () => {
  const valid = { id: 'q1', text: '2+2?', options: ['3', '4'], correctIndex: 1 };

  it('accepts a well-formed bank', () => {
    expect(validateQuestionBank([valid])).toEqual([]);
  });

  it('rejects an empty bank', () => {
    expect(validateQuestionBank([])).toHaveLength(1);
    expect(validateQuestionBank(null)).toHaveLength(1);
  });

  it('rejects a correctIndex past the end of the options', () => {
    // The load-bearing check: this question could never be answered correctly.
    const errors = validateQuestionBank([{ ...valid, correctIndex: 5 }]);
    expect(errors.join(' ')).toContain('correctIndex');
  });

  it('rejects a negative or fractional correctIndex', () => {
    expect(validateQuestionBank([{ ...valid, correctIndex: -1 }])).not.toEqual([]);
    expect(validateQuestionBank([{ ...valid, correctIndex: 1.5 }])).not.toEqual([]);
  });

  it('requires at least two options', () => {
    expect(validateQuestionBank([{ ...valid, options: ['only'] }])).not.toEqual([]);
  });

  it('rejects blank text and blank options', () => {
    expect(validateQuestionBank([{ ...valid, text: '  ' }])).not.toEqual([]);
    expect(validateQuestionBank([{ ...valid, options: ['a', ' '] }])).not.toEqual([]);
  });

  it('rejects duplicate ids', () => {
    const errors = validateQuestionBank([valid, { ...valid, text: 'other' }]);
    expect(errors.join(' ')).toContain('duplicate');
  });

  it('reports every problem at once so the editor can show them all', () => {
    const errors = validateQuestionBank([
      { id: '', text: '', options: ['a', 'b'], correctIndex: 0 },
      { id: 'q2', text: 'ok', options: ['a'], correctIndex: 0 },
    ]);
    expect(errors.length).toBeGreaterThan(2);
  });

  it('does not check correctIndex when options are already invalid', () => {
    // Avoids a confusing "correctIndex must be between 0 and -1".
    const errors = validateQuestionBank([{ id: 'q1', text: 'x', options: [], correctIndex: 9 }]);
    expect(errors.join(' ')).not.toContain('and -1');
  });
});

describe('age gate', () => {
  const now = new Date('2026-07-25T00:00:00Z');

  it('computes age from a date of birth', () => {
    expect(ageInYears(new Date('2016-07-25'), now)).toBe(10);
    // Birthday not reached yet this year.
    expect(ageInYears(new Date('2016-07-26'), now)).toBe(9);
  });

  it('lets everyone play an all-ages game', () => {
    expect(isAgeAppropriate(null, new Date('2019-01-01'))).toBe(true);
  });

  it('keeps a 7-year-old out of the 13-16 quiz - the defect being fixed', () => {
    const sevenYearOld = new Date('2019-01-01');
    expect(isAgeAppropriate('13-16', sevenYearOld)).toBe(false);
  });

  it('admits a child inside the band', () => {
    expect(isAgeAppropriate('10-12', new Date('2015-01-01'))).toBe(true);
  });

  it('excludes a child who has outgrown the band', () => {
    expect(isAgeAppropriate('10-12', new Date('2008-01-01'))).toBe(false);
  });

  it('treats an unknown date of birth as eligible', () => {
    // Hiding content from a child whose DOB was never recorded is the worse failure.
    expect(isAgeAppropriate('13-16', null)).toBe(true);
  });

  it('ignores an unparseable age band rather than blocking the game', () => {
    expect(isAgeAppropriate('all-ages', new Date('2019-01-01'))).toBe(true);
  });
});
