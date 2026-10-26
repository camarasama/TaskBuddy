/**
 * lib/adminInsightsApi.ts - admin Overview metrics and re-engagement controls (2026-10-26).
 * Kept out of api.ts, which is already far past the 500-line house limit.
 */

import { request } from './api';
import type { ApiResponse } from '@taskbuddy/shared';

export type InsightsRange = '7d' | '30d' | '90d' | '12m';
export type Stage = 'new' | 'engaged' | 'at_risk' | 'dormant' | 'one_and_done' | 'churned';
export type NudgeStage = 'one_and_done' | 'dormant' | 'at_risk';
export type Track = 'setup' | 'lapsed';

export interface InsightsOverview {
  range: InsightsRange;
  includeTesters: boolean;
  generatedAt: string;
  testFamilies: number;
  kpis: {
    families: { value: number; newInRange: number; newPrevRange: number };
    parents: { value: number; perFamily: number | null; coParentShare: number | null };
    children: { value: number; perFamily: number | null; activeLast7d: number };
    weeklyActive: { value: number; pct: number | null };
    activation: { rate: number | null; cohort: number; prevRate: number | null };
    churn30d: { rate: number | null; prevRate: number | null };
  };
  activity: { stepDays: number; points: Array<{ day: string; daily: number; weekly: number }> };
  engagement: {
    stickiness: number | null;
    tasksApprovedPerActiveFamilyPerWeek: number | null;
    medianApprovalHours: number | null;
    monthlyActiveFamilies: number;
  };
  lifecycle: Record<Stage, number>;
  weeklySignups: Array<{ weekStart: string; total: number; activated: number }>;
  cohorts: Array<{ weekStart: string; size: number; cells: Array<number | null> }>;
  adoption: {
    activeFamilies: number;
    features: Array<{ key: string; label: string; families: number; pct: number | null }>;
  };
  health: {
    emailDeliveryRate: number | null;
    emailsFailed: number;
    serverLoadPct: number;
    memoryMb: number;
    uptimeHours: number;
    pendingApprovals: number;
  };
}

export interface NudgeFamily {
  id: string;
  familyName: string;
  parents: number;
  children: number;
  createdAt: string;
  lastActiveAt: string | null;
  stage: NudgeStage;
  paused: boolean;
  reachableParents: number;
  suspended: boolean;
  plan: {
    track: Track;
    sentSteps: number[];
    lastSentAt: string | null;
    nextStep: number | null;
    nextDueAt: string | null;
  } | null;
}

export interface NudgeList {
  counts: { all: number; one_and_done: number; dormant: number; at_risk: number };
  total: number;
  page: number;
  limit: number;
  families: NudgeFamily[];
}

export interface ReengagementStats {
  paused: boolean;
  familiesInTrack: number;
  emailsSent30d: number;
  familiesEmailed30d: number;
  familiesReturned30d: number;
  unsubscribes: number;
  steps: Array<{ track: Track; steps: Array<{ step: number; sent: number; cameBack: number }> }>;
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export const adminInsightsApi = {
  overview: (range: InsightsRange, includeTesters: boolean) =>
    request<ApiResponse<InsightsOverview>>(`/admin/insights/overview?range=${range}&includeTesters=${includeTesters}`),

  nudges: (params: { stage?: NudgeStage; page?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.stage) q.set('stage', params.stage);
    if (params.page) q.set('page', String(params.page));
    const qs = q.toString();
    return request<ApiResponse<NudgeList>>(`/admin/insights/nudges${qs ? `?${qs}` : ''}`);
  },

  reengagement: () => request<ApiResponse<ReengagementStats>>('/admin/reengagement'),

  setGlobalPause: (paused: boolean) =>
    request<ApiResponse<{ paused: boolean }>>('/admin/reengagement/settings', json('PATCH', { paused })),

  sendTest: (track: Track, step: number) =>
    request<ApiResponse<{ sentTo: string }>>('/admin/reengagement/test', json('POST', { track, step })),

  sendNext: (familyId: string) =>
    request<ApiResponse<{ sent: boolean; recipients: number; step?: number; track?: Track }>>(
      `/admin/reengagement/families/${familyId}/send-next`,
      { method: 'POST' },
    ),

  setFamilyPause: (familyId: string, paused: boolean) =>
    request<ApiResponse<{ paused: boolean }>>(`/admin/reengagement/families/${familyId}/pause`, json('PATCH', { paused })),

  setTestAccount: (familyId: string, isTestAccount: boolean) =>
    request<ApiResponse<{ isTestAccount: boolean }>>(`/admin/families/${familyId}/test-account`, json('PATCH', { isTestAccount })),

  unsubscribe: (u: string, t: string) =>
    request<ApiResponse<{ unsubscribed: boolean }>>('/email/unsubscribe', json('POST', { u, t })),
};

/** Copy shared by the Overview and Re-engagement pages, so the two never disagree. */
export const STAGE_INFO: Record<Stage, { label: string; rule: string }> = {
  new: { label: 'New', rule: 'Signed up in the last 7 days' },
  engaged: { label: 'Engaged', rule: 'Active in the last 7 days' },
  at_risk: { label: 'At risk', rule: 'Last active 7 to 21 days ago' },
  dormant: { label: 'Dormant', rule: 'Last active 22 to 60 days ago' },
  one_and_done: { label: 'One-and-done', rule: 'Never came back after their first day' },
  churned: { label: 'Churned', rule: 'Silent for more than 60 days' },
};

export const TRACK_INFO: Record<Track, { title: string; who: string; days: number[]; subjects: string[] }> = {
  setup: {
    title: 'Finish setting up',
    who: 'Families with no approved task yet. Days count from signup.',
    days: [2, 5, 10, 21],
    subjects: [
      'Your family’s first task takes 2 minutes',
      '3 tasks families start with',
      'Less nagging, more teamwork',
      'Should we keep your family’s space?',
    ],
  },
  lapsed: {
    title: 'We miss you',
    who: 'Families who got going, then went quiet. Days count from the last activity.',
    days: [14, 21, 35, 60],
    subjects: [
      'Look what your family did together',
      'New on TaskBuddy: games and team tasks',
      'A fresh start for the new week',
      'Should we keep your family’s space?',
    ],
  },
};
