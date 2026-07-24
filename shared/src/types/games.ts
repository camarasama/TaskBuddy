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

/** POST /games/sessions/:id/submit */
export interface GameSubmitResult {
  correct: boolean;
  pointsAwarded: number;
  xpAwarded: number;
  cappedMessage?: string;
}
