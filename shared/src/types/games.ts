// Games API types (PE Mini Games) - mirrors backend/src/routes/games.ts.

/** GET /games - one entry in the game list, with cooldown status computed per-child. */
export interface GameDefinition {
  id: string;
  type: string;
  title: string;
  description: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  pointsReward: number;
  xpReward: number;
  cooldownHours: number;
  ageGroup: string | null;
  questionCount: number;
  onCooldown: boolean;
  cooldownEndsAt: Date | null;
}

export interface GamesListResponse {
  games: GameDefinition[];
}

/** A quiz question with the correct answer stripped (never sent to the client). */
export interface GameQuestion {
  id: string;
  text: string;
  options: string[];
}

/** POST /games/sessions - starting a session returns questions WITHOUT answers. */
export interface GameSession {
  sessionId: string;
  expiresAt: Date;
  game: {
    title: string;
    difficulty: 'easy' | 'medium' | 'hard';
    pointsReward: number;
    xpReward: number;
  };
  questions: GameQuestion[];
}

/**
 * GET /games/sessions/:id - resume an in-progress session after a refresh.
 * `answeredCount` says how far the child got; it reveals nothing about the remaining questions.
 */
export interface GameSessionResume extends GameSession {
  answeredCount: number;
}

/**
 * POST /games/sessions/:id/answer - lock ONE answer and learn immediately whether it was right.
 *
 * All indexes are in DISPLAY order (options are shuffled per session), so the UI can highlight
 * `correctIndex` directly. Revealing it here is safe: the choice is already committed server-side
 * and re-answering the same question is rejected.
 */
export interface GameAnswerResult {
  questionIndex: number;
  correct: boolean;
  correctIndex: number;
  answeredCount: number;
  totalQuestions: number;
}

/** One row of the end-of-quiz review, all indexes in display order. */
export interface GameQuestionReview {
  questionIndex: number;
  text: string;
  options: string[];
  chosenIndex: number | null;
  correctIndex: number;
  correct: boolean;
}

/** POST /games/sessions/:id/submit */
export interface GameSubmitResult {
  correctCount: number;
  totalQuestions: number;
  /** True only on a clean sweep. Retained from the pre-partial-credit API. */
  correct: boolean;
  pointsAwarded: number;
  xpAwarded: number;
  cappedMessage?: string;
  review: GameQuestionReview[];
}
