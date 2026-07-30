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
import {
  GAME_COOLDOWN_HOURS,
  GAME_REWARD_ACCURACY_FLOOR,
  GAME_REWARDS,
  type GameCategory,
  type GameLevel,
} from '@taskbuddy/shared';

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
/**
 * @deprecated Superseded by `GAME_REWARD_ACCURACY_FLOOR` in shared, which now gates points AND XP
 * together rather than XP alone. Kept only so the two cannot silently drift apart — a test asserts they
 * are equal. Remove once nothing references it.
 */
export const XP_THRESHOLD = GAME_REWARD_ACCURACY_FLOOR;

/**
 * Age bands a definition may target; `null` means all ages.
 *
 * Deliberately the same two bands as the `AgeGroup` enum on ChildProfile (schema.prisma:822) so the
 * admin editor cannot target a band the rest of the system has no way to express. The eligibility
 * check itself uses the child's real date of birth, not this enum, so it is exact rather than banded.
 */
export const AGE_GROUPS = ['10-12', '13-16'] as const;
export type AgeGroupLabel = (typeof AGE_GROUPS)[number];

// ─── Question bank validation ─────────────────────────────────────────────────

/**
 * Validate a question bank coming from the admin editor.
 *
 * Returns human-readable problems rather than throwing, so the editor can show them all at once
 * against the offending rows instead of failing on the first.
 *
 * The correctIndex bound check is the load-bearing one: an out-of-range index would make a question
 * unanswerable, and because grading compares against it the child could never score.
 */
export function validateQuestionBank(bank: unknown): string[] {
  const errors: string[] = [];

  if (!Array.isArray(bank) || bank.length === 0) {
    return ['At least one question is required.'];
  }

  const seenIds = new Set<string>();

  bank.forEach((raw, i) => {
    const label = `Question ${i + 1}`;
    const q = raw as Partial<Question>;

    if (typeof q?.id !== 'string' || q.id.trim() === '') {
      errors.push(`${label}: id is required.`);
    } else if (seenIds.has(q.id)) {
      // Duplicate ids would collide in the client's React keys and in any future per-question stats.
      errors.push(`${label}: duplicate id "${q.id}".`);
    } else {
      seenIds.add(q.id);
    }

    if (typeof q?.text !== 'string' || q.text.trim() === '') {
      errors.push(`${label}: text is required.`);
    }

    if (!Array.isArray(q?.options) || q.options.length < 2) {
      errors.push(`${label}: at least 2 options are required.`);
      return; // correctIndex cannot be checked without a valid options array
    }

    if (q.options.some((o) => typeof o !== 'string' || o.trim() === '')) {
      errors.push(`${label}: options cannot be blank.`);
    }

    if (
      typeof q?.correctIndex !== 'number' ||
      !Number.isInteger(q.correctIndex) ||
      q.correctIndex < 0 ||
      q.correctIndex >= q.options.length
    ) {
      errors.push(
        `${label}: correctIndex must be between 0 and ${q.options.length - 1}.`,
      );
    }
  });

  return errors;
}

/**
 * Whether a definition is age-appropriate for a child.
 *
 * `null` ageGroup means all ages. An unknown DOB is treated as eligible - withholding content from a
 * child whose birthday was never filled in would be a worse failure than showing it.
 */
export function isAgeAppropriate(ageGroup: string | null, dateOfBirth: Date | null): boolean {
  if (!ageGroup) return true;
  if (!dateOfBirth) return true;

  const [min, max] = ageGroup.split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return true;

  const age = ageInYears(dateOfBirth, new Date());
  return age >= min && age <= max;
}

export function ageInYears(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dateOfBirth.getUTCMonth();
  // Not had this year's birthday yet.
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age--;
  }
  return age;
}

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

// ─── Daily rotation ───────────────────────────────────────────────────────────

/** UTC calendar day key. Used as part of the rotation seed. */
export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Draw the day's questions from a bank.
 *
 * Seeded by game + UTC date, so every child in a family gets the SAME quiz on a given day (fair
 * between siblings, and it makes the quiz feel like a daily event) while tomorrow's draw differs.
 * With a bank of 25 and a draw of 5 there is no practical repetition.
 *
 * Falls back to the whole bank when it is smaller than the requested count, which is why an
 * unmigrated 5-question definition behaves exactly as before.
 */
/**
 * One row of the child's rotation index — see `GameQuestionSeen` in schema.prisma.
 */
export interface SeenQuestion {
  questionId: string;
  seenAt: Date;
}

/**
 * Draw a child's next questions: everything they have not seen first, recycling the
 * least-recently-seen only once the bank is exhausted.
 *
 * ## Why per child rather than per day
 *
 * `selectDailyQuestions` below seeds the draw on `gameId:UTC-date`, so every child got the same quiz on
 * a given day and a question could recur any number of times across days. That was the "the game doesn't
 * change" complaint. This function tracks what each child has actually been graded on, so a question
 * never reappears for them until they have seen every question in the bank.
 *
 * The trade accepted with it: **siblings no longer get the same quiz.** That was a deliberate property of
 * the daily draw, and per-child consumption is incompatible with it.
 *
 * ## Why it recycles instead of running out
 *
 * A 25-question bank drawn 5 at a time gives one child five plays before exhaustion, and no realistic
 * authoring rate keeps ahead of a keen child forever. Locking the category at that point would make the
 * app look broken. Recycling oldest-first means "never repeats until you have seen them all", which is
 * what people actually mean by no repeats, and it can never dead-end.
 *
 * `seed` is a parameter rather than internal randomness so the draw is reproducible in tests; callers
 * pass something per-play.
 */
export function selectQuestionsForChild(
  bank: Question[],
  count: number,
  seen: SeenQuestion[],
  seed: string,
): Question[] {
  if (!Array.isArray(bank) || bank.length === 0) return [];
  const want = Math.max(1, Math.min(count, bank.length));

  const seenAtById = new Map(seen.map((s) => [s.questionId, s.seenAt.getTime()]));
  const unseen = bank.filter((q) => !seenAtById.has(q.id));

  if (unseen.length >= want) return seededShuffle(unseen, seed).slice(0, want);

  // Bank exhausted (or nearly): serve every unseen question, then top up with the ones seen longest
  // ago. Sorted by seenAt so the child works through the whole bank before anything comes round twice.
  const recycled = bank
    .filter((q) => seenAtById.has(q.id))
    .sort((a, b) => (seenAtById.get(a.id) ?? 0) - (seenAtById.get(b.id) ?? 0));

  return [...seededShuffle(unseen, seed), ...recycled].slice(0, want);
}

/**
 * @deprecated Superseded by `selectQuestionsForChild`. Retained because sessions created before the
 * redesign were drawn with it, and its tests document the behaviour those sessions were graded under.
 */
export function selectDailyQuestions(
  bank: Question[],
  count: number,
  gameId: string,
  date: Date,
): Question[] {
  if (!Array.isArray(bank) || bank.length === 0) return [];
  const want = Math.max(1, Math.min(count, bank.length));
  if (want >= bank.length) return [...bank];
  return seededShuffle(bank, `${gameId}:${toDateKey(date)}`).slice(0, want);
}

/**
 * The questions a session is graded against.
 *
 * Prefers the session's own snapshot. Sessions created before rotation have no snapshot, so they
 * fall back to the definition's bank - the same list they were served.
 */
export function resolveSessionQuestions(
  servedQuestionsJson: unknown,
  definitionBank: Question[],
): Question[] {
  if (Array.isArray(servedQuestionsJson) && servedQuestionsJson.length > 0) {
    return servedQuestionsJson as Question[];
  }
  return definitionBank;
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

/** Points and XP for a level. The single accessor — see the note on GAME_REWARDS. */
export function rewardsForLevel(level: GameLevel): { points: number; xp: number } {
  return GAME_REWARDS[level];
}

/** Cooldown hours for a category. Completing any game in it times out the whole category. */
export function cooldownHoursForCategory(category: GameCategory): number {
  return GAME_COOLDOWN_HOURS[category];
}

/**
 * What a finished session pays.
 *
 * Three gates, in order:
 *
 *  1. **Accuracy floor.** Below `GAME_REWARD_ACCURACY_FLOOR` (60%) a session pays nothing at all — not
 *     points, not XP — so clicking through options at random is worth zero. Above it, points scale with
 *     the share correct and XP is paid in full, so 3 of 5 still earns; that is what partial credit was
 *     introduced for.
 *  2. **Once per category per day.** `pointsAlreadyEarnedInCategoryToday` zeroes the points but never the
 *     XP. This is the gate a child can actually predict, and it is what stops six categories a day
 *     turning into a better income than chores.
 *  3. **The family's daily cap**, as a backstop.
 *
 * Reward values come from the level, not from the definition's columns — an admin typo cannot inflate the
 * economy. XP is deliberately never capped: a child who has hit their points ceiling and then aces a quiz
 * still levels up, because XP is progression and is never spent.
 */
export function computeAward(
  level: GameLevel,
  correctCount: number,
  totalQuestions: number,
  remainingCap: number,
  pointsAlreadyEarnedInCategoryToday: boolean,
): AwardResult {
  if (totalQuestions <= 0 || correctCount <= 0) {
    return { pointsAwarded: 0, xpAwarded: 0 };
  }

  const share = correctCount / totalQuestions;
  const { points, xp } = rewardsForLevel(level);

  if (share < GAME_REWARD_ACCURACY_FLOOR) {
    return {
      pointsAwarded: 0,
      xpAwarded: 0,
      cappedMessage: `You need ${Math.ceil(GAME_REWARD_ACCURACY_FLOOR * totalQuestions)} of ${totalQuestions} right to earn points. Try again!`,
    };
  }

  const xpAwarded = xp;

  if (pointsAlreadyEarnedInCategoryToday) {
    return {
      pointsAwarded: 0,
      xpAwarded,
      cappedMessage: `You already earned today's points for this subject — this one is worth ${xpAwarded} XP.`,
    };
  }

  const earned = Math.round(points * share);
  const pointsAwarded = Math.max(0, Math.min(earned, remainingCap));

  return {
    pointsAwarded,
    xpAwarded,
    cappedMessage:
      pointsAwarded < earned
        ? `Daily game points cap reached. You earned ${pointsAwarded} pts.`
        : undefined,
  };
}
