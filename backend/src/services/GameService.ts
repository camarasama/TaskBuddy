/**
 * services/GameService.ts
 *
 * Pure game logic, deliberately free of Prisma and Express so it can be unit-tested directly.
 *
 * Two properties matter here and both are load-bearing:
 *
 *  1. `correctIndex` NEVER reaches the client before an answer is locked. The route layer reveals
 *     it only in the response to POST /sessions/:id/answer, i.e. after the child's choice is
 *     already committed to the DB and re-answers are rejected.
 *
 *  2. Option shuffling is DERIVED, not stored. The permutation is seeded from the session id, so
 *     the server reproduces the identical order at answer- and submit-time without a schema column.
 *     A child who memorises "the answer is B" from a previous play learns nothing, because B is a
 *     different option next session.
 */

import crypto from 'crypto';

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/** A question as the client sees it: options in session order, no correctIndex. */
export interface ClientQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface AwardResult {
  pointsAwarded: number;
  xpAwarded: number;
  /** Set when the daily cap trimmed the payout. */
  cappedMessage?: string;
}

/** XP is only granted at or above this share of correct answers. */
export const XP_THRESHOLD = 0.6;

// ─── Deterministic RNG ────────────────────────────────────────────────────────

/**
 * A small deterministic PRNG seeded from a string. Not cryptographic — it only needs to be stable
 * across processes so answer-time and submit-time agree on the same permutation.
 */
function seededRandom(seed: string): () => number {
  const hash = crypto.createHash('sha256').update(seed).digest();
  let a = hash.readUInt32LE(0) || 1;
  let b = hash.readUInt32LE(4) || 2;
  let c = hash.readUInt32LE(8) || 3;
  let d = hash.readUInt32LE(12) || 4;

  // xoshiro128** — fast, well-distributed, and trivially portable.
  return function next(): number {
    const t = b << 9;
    let r = b * 5;
    r = ((r << 7) | (r >>> 25)) * 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = (d << 11) | (d >>> 21);
    return (r >>> 0) / 4294967296;
  };
}

/** Fisher-Yates driven by a seeded PRNG. Returns a new array; input is not mutated. */
function seededShuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  const rand = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── Option shuffling ─────────────────────────────────────────────────────────

/**
 * Permutation for one question's options, as an array of ORIGINAL indexes in display order.
 * `perm[displayIndex] = originalIndex`.
 */
export function optionPermutation(
  sessionId: string,
  questionIndex: number,
  optionCount: number,
): number[] {
  const identity = Array.from({ length: optionCount }, (_, i) => i);
  return seededShuffle(identity, `${sessionId}:${questionIndex}`);
}

/** Present a question with its options in session order, stripped of the answer. */
export function toClientQuestion(
  question: Question,
  sessionId: string,
  questionIndex: number,
): ClientQuestion {
  const perm = optionPermutation(sessionId, questionIndex, question.options.length);
  return {
    id: question.id,
    text: question.text,
    options: perm.map((originalIndex) => question.options[originalIndex]),
  };
}

export function toClientQuestions(questions: Question[], sessionId: string): ClientQuestion[] {
  return questions.map((q, i) => toClientQuestion(q, sessionId, i));
}

/**
 * Where the correct answer sits in the SHUFFLED order — this is what the client is told after
 * locking, so it can highlight the right option in the order the child actually sees.
 */
export function displayIndexOfCorrect(
  question: Question,
  sessionId: string,
  questionIndex: number,
): number {
  const perm = optionPermutation(sessionId, questionIndex, question.options.length);
  return perm.indexOf(question.correctIndex);
}

/** Translate a client's display-order choice back to the original option index. */
export function toOriginalIndex(
  displayIndex: number,
  sessionId: string,
  questionIndex: number,
  optionCount: number,
): number {
  const perm = optionPermutation(sessionId, questionIndex, optionCount);
  return perm[displayIndex];
}

// ─── Answer storage ───────────────────────────────────────────────────────────

/** Stored answers: original option index per question, null while unanswered. */
export type StoredAnswers = (number | null)[];

export function emptyAnswers(questionCount: number): StoredAnswers {
  return Array.from({ length: questionCount }, () => null);
}

/**
 * Normalise whatever is in the JSON column into a fixed-length array. Sessions created before this
 * feature have `answersJson = null`, and a definition's question count can change under a live
 * session if an admin edits it, so never trust the stored length.
 */
export function parseAnswers(raw: unknown, questionCount: number): StoredAnswers {
  const answers = emptyAnswers(questionCount);
  if (!Array.isArray(raw)) return answers;
  for (let i = 0; i < questionCount; i++) {
    const v = raw[i];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0) answers[i] = v;
  }
  return answers;
}

export function allAnswered(answers: StoredAnswers): boolean {
  return answers.length > 0 && answers.every((a) => a !== null);
}

// ─── Grading ──────────────────────────────────────────────────────────────────

export interface QuestionReview {
  questionIndex: number;
  text: string;
  /** Options in the order the child saw them. */
  options: string[];
  /** The child's choice in display order; null if they never answered it. */
  chosenIndex: number | null;
  /** The correct option in display order. */
  correctIndex: number;
  correct: boolean;
}

export function isCorrect(question: Question, storedAnswer: number | null): boolean {
  return storedAnswer !== null && storedAnswer === question.correctIndex;
}

export function countCorrect(questions: Question[], answers: StoredAnswers): number {
  return questions.reduce((n, q, i) => (isCorrect(q, answers[i]) ? n + 1 : n), 0);
}

/**
 * Per-question breakdown for the end-of-quiz review screen. Everything is expressed in DISPLAY
 * order so the client can render it without knowing about the permutation.
 */
export function buildReview(
  questions: Question[],
  answers: StoredAnswers,
  sessionId: string,
): QuestionReview[] {
  return questions.map((q, i) => {
    const stored = answers[i];
    const perm = optionPermutation(sessionId, i, q.options.length);
    return {
      questionIndex: i,
      text: q.text,
      options: perm.map((originalIndex) => q.options[originalIndex]),
      chosenIndex: stored === null ? null : perm.indexOf(stored),
      correctIndex: perm.indexOf(q.correctIndex),
      correct: isCorrect(q, stored),
    };
  });
}

// ─── Award calculation ────────────────────────────────────────────────────────

/**
 * Partial credit: points scale with the share correct, XP is all-or-nothing above XP_THRESHOLD.
 *
 * Replaces the previous all-or-nothing rule where 4 of 5 correct paid zero. `remainingCap` is the
 * child's unused daily game allowance and trims the payout without ever going negative.
 */
export function computeAward(
  pointsReward: number,
  xpReward: number,
  correctCount: number,
  totalQuestions: number,
  remainingCap: number,
): AwardResult {
  if (totalQuestions <= 0 || correctCount <= 0) {
    return { pointsAwarded: 0, xpAwarded: 0 };
  }

  const share = correctCount / totalQuestions;
  const earned = Math.round(pointsReward * share);
  const pointsAwarded = Math.max(0, Math.min(earned, remainingCap));

  // XP tracks the child's performance, not the cap — a capped-out child who aced the quiz still
  // levels up. Points are the scarce currency; XP is progression and is never spent.
  const xpAwarded = share >= XP_THRESHOLD ? xpReward : 0;

  return {
    pointsAwarded,
    xpAwarded,
    cappedMessage:
      pointsAwarded < earned
        ? `Daily game points cap reached. You earned ${pointsAwarded} pts.`
        : undefined,
  };
}
