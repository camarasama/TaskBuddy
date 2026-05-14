import type { TaskDifficulty } from '../types/models';

export function difficultyFromPoints(points: number): TaskDifficulty {
  if (points <= 15) return 'easy';
  if (points <= 30) return 'medium';
  return 'hard';
}
