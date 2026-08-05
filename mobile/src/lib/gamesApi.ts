/**
 * Games — the quiz loop.
 *
 * Every type here comes from `shared/src/types/games.ts` and every constant from
 * `shared/src/constants/games.ts`. Nothing about the taxonomy or the economy is restated on the device:
 * the category and level lists, their labels, the per-level rewards and the cooldown hours are all
 * shared, which is why adding a seventh category is a content change rather than a mobile release.
 *
 * ## What the server decides, and this module never second-guesses
 *
 * - **Cooldown is category-wide.** Completing any maths game puts every maths game on the timer.
 *   `GameDefinition.onCooldown` already accounts for it, so several entries flip together and the UI
 *   just reads the flag.
 * - **Points are awarded once per category per day**; later plays that day earn XP only. The submit
 *   response says what was actually paid via `pointsAwarded` and an optional `cappedMessage` — so the
 *   result screen reports what happened rather than predicting it from the level's face value.
 * - **Correct answers are never in the list payload.** `GameQuestion` carries only `text` and `options`;
 *   `correctIndex` arrives one question at a time from the answer endpoint, after the choice is already
 *   committed server-side. There is nothing to cheat with on the device.
 *
 * ## On resume
 *
 * `POST /games/sessions` **expires any lingering `in_progress` session for that game** before creating a
 * new one. So resume means "this screen re-mounted mid-quiz" — a rotation, a tab switch, a fast
 * app-switch — not "the app was killed yesterday". `GET /games/sessions/:id` returns `answeredCount`, so
 * a re-mount lands on the question the child was actually on rather than restarting them. The session id
 * travels as a route param, matching the web, which carries it in the query string.
 */
import type {
  GameAnswerResult,
  GameDefinition,
  GameHistoryResponse,
  GameReviewResponse,
  GameSession,
  GameSessionResume,
  GameSubmitResult,
  GamesListResponse,
} from '@taskbuddy/shared';
import { GAME_CATEGORIES, GAME_LEVELS, type GameCategory, type GameLevel } from '@taskbuddy/shared';

import { api } from './api';
import { CHILD_DASHBOARD_KEY } from './childDashboardApi';

export const GAMES_KEY = ['games', 'list'] as const;
export const GAME_HISTORY_KEY = ['games', 'history'] as const;

export function gameSessionKey(sessionId: string) {
  return ['games', 'session', sessionId] as const;
}

export function gameReviewKey(sessionId: string) {
  return ['games', 'review', sessionId] as const;
}

export function fetchGames(signal?: AbortSignal): Promise<GamesListResponse> {
  return api.get<GamesListResponse>('/games', { signal });
}

export function fetchHistory(signal?: AbortSignal): Promise<GameHistoryResponse> {
  return api.get<GameHistoryResponse>('/games/history', { signal });
}

export function fetchReview(sessionId: string, signal?: AbortSignal): Promise<GameReviewResponse> {
  return api.get<GameReviewResponse>(`/games/history/${sessionId}`, { signal });
}

export function resumeSession(sessionId: string, signal?: AbortSignal): Promise<GameSessionResume> {
  return api.get<GameSessionResume>(`/games/sessions/${sessionId}`, { signal });
}

export function gamesQuery() {
  return {
    queryKey: GAMES_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchGames(signal),
    // Cooldowns expire in real time, so a cached list goes wrong in the direction that matters: it
    // shows a category as locked minutes after it opened.
    staleTime: 0,
  };
}

export function historyQuery() {
  return {
    queryKey: GAME_HISTORY_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchHistory(signal),
  };
}

export function reviewQuery(sessionId: string) {
  return {
    queryKey: gameReviewKey(sessionId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchReview(sessionId, signal),
    // A finished game never changes.
    staleTime: Infinity,
  };
}

// ── Playing ──────────────────────────────────────────────────────────────────

export function startSession(gameDefinitionId: string): Promise<GameSession> {
  return api.post<GameSession>('/games/sessions', { gameDefinitionId });
}

/**
 * Lock one answer.
 *
 * Both indexes are in **display** order — options are shuffled per session — so `correctIndex` in the
 * response can be used to highlight directly without any re-mapping. Re-answering the same question is
 * rejected server-side, which is what makes returning the correct index here safe.
 */
export function answerQuestion(
  sessionId: string,
  questionIndex: number,
  answerIndex: number
): Promise<GameAnswerResult> {
  return api.post<GameAnswerResult>(`/games/sessions/${sessionId}/answer`, {
    questionIndex,
    answerIndex,
  });
}

/** Submit. Rejected with a 400 unless every question has been answered. */
export function submitSession(sessionId: string): Promise<GameSubmitResult> {
  return api.post<GameSubmitResult>(`/games/sessions/${sessionId}/submit`, {});
}

/**
 * What finishing a game changes.
 *
 * The dashboard because points, XP and level move; the games list because the category's cooldown just
 * started and every game in it flips to locked; the history because a row was added.
 */
export const INVALIDATED_BY_GAME_SUBMIT = [
  GAMES_KEY,
  GAME_HISTORY_KEY,
  CHILD_DASHBOARD_KEY,
] as const;

// ── Grouping for the picker ──────────────────────────────────────────────────

/** One cell of the category × level grid. */
export interface LevelCell {
  level: GameLevel;
  /** The game to launch, or null when this family has no active game at this combination. */
  game: GameDefinition | null;
}

export interface CategoryGroup {
  category: GameCategory;
  levels: LevelCell[];
  /** Category-wide, so one entry answers for the whole row. */
  onCooldown: boolean;
  cooldownEndsAt: Date | null;
}

/**
 * Arrange a flat game list into the category × level grid the picker draws.
 *
 * Iterates the shared constants rather than the payload, so a category with no authored content still
 * appears — as an explicitly empty row rather than silently vanishing. A missing cell is a content gap
 * worth seeing; a category that disappears looks like a bug in the app.
 *
 * Cooldown is read from whichever game in the category carries it. The server scopes the flag to the
 * category, so any one of them is authoritative for the row; taking the first that is on cooldown avoids
 * depending on which order the API happened to return.
 */
export function groupByCategory(games: GameDefinition[]): CategoryGroup[] {
  return GAME_CATEGORIES.map((category) => {
    const inCategory = games.filter((g) => g.category === category);
    const cooling = inCategory.find((g) => g.onCooldown) ?? null;

    return {
      category,
      levels: GAME_LEVELS.map((level) => ({
        level,
        game: inCategory.find((g) => g.level === level) ?? null,
      })),
      onCooldown: cooling !== null,
      cooldownEndsAt: cooling?.cooldownEndsAt ?? null,
    };
  });
}

/** "back in 3h", "back in 20 min", or null when it is playable now. */
export function cooldownLabel(
  endsAt: Date | string | null | undefined,
  now = new Date()
): string | null {
  if (!endsAt) return null;
  const end = endsAt instanceof Date ? endsAt : new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;

  const ms = end.getTime() - now.getTime();
  if (ms <= 0) return null;

  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `back in ${minutes} min`;
  return `back in ${Math.ceil(minutes / 60)}h`;
}
