/**
 * Per-question game grading — the pure logic behind the two reported bugs.
 *
 * Bug 1: "no indicator that the answer chosen is correct or wrong". The client was never told,
 * because grading was a single hash compare at submit. These pin the reveal contract: the correct
 * option is expressed in the order the child actually SEES, not the stored order.
 *
 * Bug 2: partial credit. 4 of 5 correct used to pay zero.
 *
 * The shuffle tests matter beyond cosmetics: options are permuted per session and the permutation
 * is DERIVED from the session id rather than stored, so answer-time and submit-time must agree
 * exactly or every grade would be wrong.
 */

import {
  Question,
  XP_THRESHOLD,
  allAnswered,
  buildReview,
  computeAward,
  countCorrect,
  displayIndexOfCorrect,
  emptyAnswers,
  isCorrect,
  optionPermutation,
  parseAnswers,
  toClientQuestion,
  toClientQuestions,
  toOriginalIndex,
} from '../src/services/GameService';

const QUESTIONS: Question[] = [
  { id: 'q1', text: '7 x 8?', options: ['54', '56', '64', '48'], correctIndex: 1 },
  { id: 'q2', text: '144 / 12?', options: ['10', '11', '12', '13'], correctIndex: 2 },
  { id: 'q3', text: '15% of 200?', options: ['25', '30', '35', '40'], correctIndex: 1 },
  { id: 'q4', text: '2^3?', options: ['6', '8', '9', '16'], correctIndex: 1 },
  { id: 'q5', text: 'sqrt(81)?', options: ['7', '8', '9', '10'], correctIndex: 2 },
];

const SESSION = 'e8f1c2a4-0000-4000-8000-000000000001';

describe('option shuffling', () => {
  it('is a genuine permutation - every option appears exactly once', () => {
    const perm = optionPermutation(SESSION, 0, 4);
    expect([...perm].sort()).toEqual([0, 1, 2, 3]);
  });

  it('is stable for the same session+question, so submit agrees with answer', () => {
    expect(optionPermutation(SESSION, 2, 4)).toEqual(optionPermutation(SESSION, 2, 4));
  });

  it('differs between sessions, so a memorised position stops working next play', () => {
    // This is the cheap half of the anti-farming fix: knowing "the answer was B" is useless when
    // B is a different option next session.
    const perms = new Set(
      Array.from({ length: 20 }, (_, i) => optionPermutation(`session-${i}`, 0, 4).join(',')),
    );
    expect(perms.size).toBeGreaterThan(1);
  });

  it('differs between questions within one session', () => {
    const perms = new Set(
      Array.from({ length: 5 }, (_, i) => optionPermutation(SESSION, i, 4).join(',')),
    );
    expect(perms.size).toBeGreaterThan(1);
  });

  it('round-trips a display choice back to the original index', () => {
    for (let display = 0; display < 4; display++) {
      const original = toOriginalIndex(display, SESSION, 0, 4);
      const perm = optionPermutation(SESSION, 0, 4);
      expect(perm[display]).toBe(original);
    }
  });
});

describe('client-facing questions', () => {
  it('never leaks correctIndex', () => {
    const client = toClientQuestion(QUESTIONS[0], SESSION, 0);
    expect(client).not.toHaveProperty('correctIndex');
    expect(Object.keys(client).sort()).toEqual(['id', 'options', 'text']);
  });

  it('presents the same option TEXT, only reordered', () => {
    const client = toClientQuestion(QUESTIONS[0], SESSION, 0);
    expect([...client.options].sort()).toEqual([...QUESTIONS[0].options].sort());
  });

  it('reports the correct answer position in DISPLAY order, not stored order', () => {
    const client = toClientQuestion(QUESTIONS[0], SESSION, 0);
    const displayIdx = displayIndexOfCorrect(QUESTIONS[0], SESSION, 0);
    // The revealed index must point at the right answer text as rendered.
    expect(client.options[displayIdx]).toBe(QUESTIONS[0].options[QUESTIONS[0].correctIndex]);
  });

  it('shuffles every question in a set', () => {
    const clients = toClientQuestions(QUESTIONS, SESSION);
    expect(clients).toHaveLength(5);
    clients.forEach((c, i) => {
      expect([...c.options].sort()).toEqual([...QUESTIONS[i].options].sort());
    });
  });
});

describe('stored answers', () => {
  it('starts empty and is not "all answered"', () => {
    const a = emptyAnswers(5);
    expect(a).toEqual([null, null, null, null, null]);
    expect(allAnswered(a)).toBe(false);
  });

  it('treats a legacy null column as no answers rather than throwing', () => {
    // Sessions created before this feature have answersJson = null.
    expect(parseAnswers(null, 3)).toEqual([null, null, null]);
  });

  it('pads or trims to the definition length if an admin edited the question set mid-session', () => {
    expect(parseAnswers([0, 1, 2, 3, 4, 5], 3)).toEqual([0, 1, 2]);
    expect(parseAnswers([0], 3)).toEqual([0, null, null]);
  });

  it('rejects non-integer junk in the column', () => {
    expect(parseAnswers(['x', -1, 1.5, 2], 4)).toEqual([null, null, null, 2]);
  });

  it('is "all answered" only when no slot is null', () => {
    expect(allAnswered([0, 1, 2])).toBe(true);
    expect(allAnswered([0, null, 2])).toBe(false);
    expect(allAnswered([])).toBe(false);
  });
});

describe('correctness', () => {
  it('counts an unanswered question as wrong, not as a crash', () => {
    expect(isCorrect(QUESTIONS[0], null)).toBe(false);
  });

  it('counts correct answers against the ORIGINAL index', () => {
    const answers = QUESTIONS.map((q) => q.correctIndex);
    expect(countCorrect(QUESTIONS, answers)).toBe(5);
  });

  it('scores a partially correct run', () => {
    const answers = [1, 2, 1, 0, 0]; // q4 and q5 wrong
    expect(countCorrect(QUESTIONS, answers)).toBe(3);
  });
});

describe('review screen', () => {
  const answers = [1, 2, 0, 1, 2]; // q3 wrong (chose '25', correct is '30')
  const review = buildReview(QUESTIONS, answers, SESSION);

  it('returns one entry per question', () => {
    expect(review).toHaveLength(5);
  });

  it('reports the chosen and correct options in display order so the UI can highlight both', () => {
    const q3 = review[2];
    expect(q3.correct).toBe(false);
    expect(q3.options[q3.chosenIndex!]).toBe('25');
    expect(q3.options[q3.correctIndex]).toBe('30');
  });

  it('marks correct answers', () => {
    expect(review[0].correct).toBe(true);
    expect(review[0].options[review[0].correctIndex]).toBe('56');
  });

  it('handles an unanswered question without inventing a choice', () => {
    const partial = buildReview(QUESTIONS, [1, null, null, null, null], SESSION);
    expect(partial[1].chosenIndex).toBeNull();
    expect(partial[1].correct).toBe(false);
  });
});

describe('award calculation (partial credit)', () => {
  it('pays proportionally instead of all-or-nothing', () => {
    // The reported behaviour: 4/5 used to pay 0. It now pays 80%.
    const { pointsAwarded } = computeAward(25, 15, 4, 5, 1000);
    expect(pointsAwarded).toBe(20);
  });

  it('pays full points for a clean sweep', () => {
    expect(computeAward(25, 15, 5, 5, 1000).pointsAwarded).toBe(25);
  });

  it('pays nothing for zero correct', () => {
    expect(computeAward(25, 15, 0, 5, 1000)).toEqual({ pointsAwarded: 0, xpAwarded: 0 });
  });

  it('grants XP at or above the threshold and withholds it below', () => {
    expect(computeAward(25, 15, 3, 5, 1000).xpAwarded).toBe(15); // 60%
    expect(computeAward(25, 15, 2, 5, 1000).xpAwarded).toBe(0); // 40%
    expect(XP_THRESHOLD).toBe(0.6);
  });

  it('trims points to the remaining daily cap', () => {
    const res = computeAward(25, 15, 5, 5, 10);
    expect(res.pointsAwarded).toBe(10);
    expect(res.cappedMessage).toContain('10');
  });

  it('never awards negative points when the cap is already spent', () => {
    expect(computeAward(25, 15, 5, 5, 0).pointsAwarded).toBe(0);
  });

  it('still grants XP when points are capped, so progression is not blocked', () => {
    // Points are the scarce currency; XP is progression and is never spent.
    expect(computeAward(25, 15, 5, 5, 0).xpAwarded).toBe(15);
  });

  it('omits the capped message when nothing was trimmed', () => {
    expect(computeAward(25, 15, 5, 5, 1000).cappedMessage).toBeUndefined();
  });

  it('does not divide by zero on an empty question set', () => {
    expect(computeAward(25, 15, 0, 0, 100)).toEqual({ pointsAwarded: 0, xpAwarded: 0 });
  });
});
