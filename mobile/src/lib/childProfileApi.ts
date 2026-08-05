/**
 * The child's own record: achievements, the family leaderboard, and the weekly recap.
 *
 * Three read-only endpoints grouped because they answer one question — "how am I doing?" — and share a
 * tab. None of them writes anything.
 *
 * ## The leaderboard has an off switch, and it is not an empty list
 *
 * `enableLeaderboard` is a family setting. When it is off the endpoint returns `{ enabled: false,
 * entries: [] }`, which is a *different thing* from a family that has it on and no scores yet. Rendering
 * both as "no scores" would tell a child their siblings had done nothing, when in fact a parent turned
 * competition off deliberately — a choice families with a struggling child make on purpose. The response
 * is modelled as a union so a screen cannot read `entries` without deciding what `enabled` means.
 */
import type { WeekRecapResponse } from '@taskbuddy/shared';

import { api } from './api';
import type { PaginationMeta } from './tasksApi';

/** An achievement merged with this child's unlock state. */
export interface AchievementRow {
  id: string;
  name: string;
  description?: string | null;
  iconUrl?: string | null;
  category?: string | null;
  tier?: string | null;
  pointsReward: number;
  xpReward: number;
  unlocked: boolean;
  unlockedAt: string | null;
  progressValue: number | null;
}

export interface AchievementsResponse {
  achievements: AchievementRow[];
  pagination: PaginationMeta;
  /** Counted over the whole catalogue, never the current page (FR-07). */
  stats: {
    total: number;
    unlocked: number;
    totalPointsEarned: number;
    totalXpEarned: number;
  };
}

export interface LeaderboardEntry {
  childId: string;
  childName: string;
  avatarUrl?: string | null;
  weeklyPoints: number;
  weeklyTasks: number;
  currentStreak: number;
  score: number;
  rank: number;
}

/**
 * Deliberately a union rather than `{ enabled: boolean; entries: [] }`.
 *
 * A flat shape lets a screen map over `entries` and never notice `enabled`, which is exactly the bug
 * this prevents: a disabled leaderboard rendering as "nobody has any points".
 */
export type LeaderboardResponse =
  | { enabled: false; entries: [] }
  | { enabled: true; period: string; entries: LeaderboardEntry[]; updatedAt: string };

export const ACHIEVEMENTS_KEY = ['achievements', 'child'] as const;
export const LEADERBOARD_KEY = ['dashboard', 'leaderboard'] as const;
export const RECAP_KEY = ['dashboard', 'child', 'recap'] as const;

export function fetchAchievements(signal?: AbortSignal): Promise<AchievementsResponse> {
  // No explicit limit: the route defaults to MAX_LIMIT for this endpoint precisely so the catalogue is
  // never silently truncated to 20. Sending a page size would undo that.
  return api.get<AchievementsResponse>('/achievements', { signal });
}

export function fetchLeaderboard(signal?: AbortSignal): Promise<LeaderboardResponse> {
  return api.get<LeaderboardResponse>('/dashboard/leaderboard?period=weekly', { signal });
}

export function fetchRecap(signal?: AbortSignal): Promise<WeekRecapResponse> {
  return api.get<WeekRecapResponse>('/dashboard/child/recap', { signal });
}

export function achievementsQuery() {
  return {
    queryKey: ACHIEVEMENTS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchAchievements(signal),
  };
}

export function leaderboardQuery() {
  return {
    queryKey: LEADERBOARD_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchLeaderboard(signal),
  };
}

export function recapQuery() {
  return {
    queryKey: RECAP_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchRecap(signal),
  };
}
