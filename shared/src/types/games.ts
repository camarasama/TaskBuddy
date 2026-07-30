// Games API types - mirrors backend/src/routes/games.ts.

import type { GameCategory, GameLevel } from '../constants/games';

/**
 * GET /games - one entry in the game list.
 *
 * `onCooldown` is now CATEGORY-scoped: completing any game in a category puts every game in that
 * category on the timer, so several entries flip together.
 */
export interface GameDefinition {
  id: string;
  type: string;
  title: string;
  description: string | null;
  /** Subject axis the child picks. */
  category: GameCategory;
  /** Difficulty axis the child picks. */
  level: GameLevel;
  /** @deprecated Superseded by `level`. Still returned so existing screens keep rendering. */
  difficulty: 'easy' | 'medium' | 'hard';
  /** Derived from `level` (GAME_REWARDS), not from the stored column. */
  pointsReward: number;
  /** Derived from `level` (GAME_REWARDS), not from the stored column. */
  xpReward: number;
  /** Derived from `category` (GAME_COOLDOWN_HOURS). */
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

// ─── History and review (child-facing) ───────────────────────────────────────

/** The game a past session belonged to, as the history screens need it. */
export interface GameHistoryGame {
  id: string;
  title: string;
  category: GameCategory;
  level: GameLevel;
}

/** GET /games/history — one finished game, newest first. */
export interface GameHistoryEntry {
  sessionId: string;
  playedAt: string;
  game: GameHistoryGame;
  correctCount: number;
  totalQuestions: number;
  pointsAwarded: number;
  xpAwarded: number;
}

export interface GameHistoryResponse {
  sessions: GameHistoryEntry[];
}

/**
 * GET /games/history/:id — the per-question review of a finished game.
 *
 * Same `review` shape the submit response returns, so one renderer serves both the end-of-quiz screen and
 * looking a game up later. Option order is derived from the session id, so the child sees the layout they
 * actually played rather than a re-shuffled one.
 */
export interface GameReviewResponse extends GameHistoryEntry {
  review: GameQuestionReview[];
}

// ─── Admin: game authoring (/admin/games) ────────────────────────────────────

/**
 * A question INCLUDING its answer. Only ever sent to admins on the authoring routes - the
 * child-facing endpoints strip correctIndex.
 */
export interface AdminGameQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/** Whether the bank is large enough for the daily draw to actually feel varied. */
export type RotationHealth = 'none' | 'low' | 'good';

/** GET /admin/games - one row of the management list. */
export interface AdminGameSummary {
  id: string;
  type: string;
  title: string;
  description: string | null;
  category: GameCategory;
  level: GameLevel;
  /** @deprecated Superseded by `level`. */
  difficulty: 'easy' | 'medium' | 'hard';
  pointsReward: number;
  xpReward: number;
  cooldownHours: number;
  ageGroup: string | null;
  questionsPerSession: number;
  bankSize: number;
  isActive: boolean;
  totalSessions: number;
  completedSessions: number;
  avgPointsAwarded: number;
  rotationHealth: RotationHealth;
  createdAt: string;
  updatedAt: string;
}

/** GET /admin/games/:id - the authoring view. */
export interface AdminGameDetail {
  id: string;
  type: string;
  title: string;
  description: string | null;
  category: GameCategory;
  level: GameLevel;
  /** @deprecated Superseded by `level`. */
  difficulty: 'easy' | 'medium' | 'hard';
  pointsReward: number;
  xpReward: number;
  cooldownHours: number;
  ageGroup: string | null;
  questionsPerSession: number;
  isActive: boolean;
  totalSessions: number;
  questions: AdminGameQuestion[];
}

/** Body for POST /admin/games and PATCH /admin/games/:id (patch accepts any subset). */
export interface AdminGameInput {
  type?: string;
  title: string;
  description?: string | null;
  category: GameCategory;
  level: GameLevel;
  /** @deprecated Superseded by `level`; still accepted so older admin clients keep working. */
  difficulty: 'easy' | 'medium' | 'hard';
  /**
   * Accepted but IGNORED — normalised on write from `level`/`category` via the shared constants, so the
   * stored numbers can never disagree with what a child is actually paid.
   */
  pointsReward?: number;
  xpReward?: number;
  cooldownHours?: number;
  ageGroup?: string | null;
  questionsPerSession: number;
  questions: AdminGameQuestion[];
  isActive?: boolean;
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

// ─── Task template library + reward presets (growth roadmap §3.1) ────────────
//
// Kept alongside the games types because both are "shipped starter content the parent picks from".

/** One template, as offered to a parent. Never carries another family's rows. */
export interface TaskTemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  difficulty: string | null;
  suggestedPoints: number;
  estimatedMinutes: number | null;
  /** '10-12' | '13-16' | null (all ages). */
  ageRange: string | null;
  requiresPhotoEvidence: boolean;
  /** False for a template the family authored itself. */
  isSystemTemplate: boolean;
}

export interface TemplatePack {
  category: string;
  templateCount: number;
  ageRanges: string[];
}

/**
 * Result of adding a whole pack.
 *
 * `skippedForCapacity` is not an error: CR-10 caps a child at 3 active assignments, so a pack fills
 * the family library in full and assigns only what fits. The UI must surface this, not hide it.
 */
export interface ApplyPackResult {
  category: string;
  created: number;
  assigned: number;
  skippedForCapacity: number;
  message: string;
}

/**
 * U19 — a preset with its ranking signals. Global `popularity` is computed over SYSTEM PRESET NAMES
 * ONLY; a family's own free-text reward names never enter that aggregate.
 */
export interface RankedRewardPreset extends RewardPreset {
  /** Times THIS family has redeemed a reward of this name. */
  familyRedemptions: number;
  /** Times any family has redeemed a preset of this name. */
  popularity: number;
  /** The family already has an active reward with this name. Flagged, never hidden. */
  alreadyAdded: boolean;
}

export interface RewardPreset {
  name: string;
  description: string;
  pointsCost: number;
  tier: 'small' | 'medium' | 'large';
}
