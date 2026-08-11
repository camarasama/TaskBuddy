/**
 * Family settings, co-parents, the calendar and insights.
 *
 * ## Two response conventions in one module, which is not a mistake
 *
 * `/families/*` and `/dashboard/calendar` use the standard `{ success, data }` envelope.
 * **`/reports/*` does not** — like `/notifications/*`, its handlers answer with bare objects
 * (`res.json(await getInsights(...))`). Those calls pass `raw: true`; without it they throw on a
 * 200. Two parts of the API now behave this way, so the rule when adding a call is to check the
 * handler rather than assume.
 */
import type { FamilySettings } from '@taskbuddy/shared';

import { api } from './api';

// ── Settings ─────────────────────────────────────────────────────────────────

/**
 * The subset of settings this endpoint accepts. Not the model: `FamilySettings` carries columns the
 * update schema rejects, so a screen typed against the model would compile and 400.
 */
export interface SettingsInput {
  /** Recurring tasks skip the approval queue entirely. Off by default, and worth being sure about. */
  autoApproveRecurringTasks?: boolean;
  enableDailyChallenges?: boolean;
  /** Off is a legitimate, considered choice for a family with one child who always loses. */
  enableLeaderboard?: boolean;
  /** 0–12. How long after midnight a streak survives an unfinished day. */
  streakGracePeriodHours?: number;
  timezone?: string;
}

export const FAMILY_SETTINGS_KEY = ['family', 'settings'] as const;
export const FAMILY_KEY = ['family', 'me'] as const;

export function fetchSettings(signal?: AbortSignal): Promise<{ settings: FamilySettings }> {
  return api.get<{ settings: FamilySettings }>('/families/me/settings', { signal });
}

export function updateSettings(input: SettingsInput): Promise<{ settings: FamilySettings }> {
  return api.put<{ settings: FamilySettings }>('/families/me/settings', input);
}

export function settingsQuery() {
  return {
    queryKey: FAMILY_SETTINGS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchSettings(signal),
  };
}

/** Rename the family. 2–100 characters. */
export function updateFamilyName(familyName: string): Promise<unknown> {
  return api.put('/families/me', { familyName });
}

// ── Co-parents ───────────────────────────────────────────────────────────────

export interface ParentMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface PendingInvitation {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
}

export const PARENTS_KEY = ['family', 'parents'] as const;

export function fetchParents(
  signal?: AbortSignal
): Promise<{ parents: ParentMember[]; pendingInvites: PendingInvitation[] }> {
  // ⚠️ `pendingInvites`, NOT `invitations`. That is the key `inviteService.listParents` returns and
  // the one the web reads. This was typed as `invitations` until 2026-08-11, which made the field
  // `undefined` at runtime and crashed the co-parents screen on `.length` — a TypeError in render,
  // reported from a real device (TASKBUDDY-MOBILE-1). TypeScript could not catch it: the annotation
  // was the thing that was wrong, so it type-checked perfectly against a lie.
  return api.get<{ parents: ParentMember[]; pendingInvites: PendingInvitation[] }>(
    '/families/me/parents',
    { signal }
  );
}

export function parentsQuery() {
  return {
    queryKey: PARENTS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchParents(signal),
  };
}

/** Send a co-parent invitation. The invitee gets an emailed link; nothing happens until they accept. */
export function inviteCoParent(email: string): Promise<unknown> {
  return api.post('/families/me/invite', { email });
}

/** Withdraw an invitation that has not been accepted. */
export function revokeInvitation(id: string): Promise<unknown> {
  return api.delete(`/families/me/invitations/${id}`);
}

/**
 * Remove a co-parent from the family.
 *
 * Deliberately exposed but used behind a confirmation in the UI: this is one adult removing
 * another's access to their children's data, which is not an action to make one tap away.
 */
export function removeCoParent(id: string): Promise<unknown> {
  return api.delete(`/families/me/parents/${id}`);
}

// ── Calendar ─────────────────────────────────────────────────────────────────

export interface CalendarEntry {
  assignmentId: string;
  taskId: string;
  title: string;
  status: string;
  startTime: string | null;
  estimatedMinutes: number | null;
  /** False when the task has no start time. **A calendar must not invent one.** */
  isTimed: boolean;
  pointsValue: number;
  /** True when this entry's window overlaps another for the same child on the same day. */
  overlaps: boolean;
}

export interface CalendarWeek {
  weekStart: string;
  weekEnd: string;
  /** YYYY-MM-DD for each of the seven days, Monday first. */
  dates: string[];
  children: { childId: string; firstName: string; days: { date: string; entries: CalendarEntry[] }[] }[];
}

export function fetchCalendar(date: string | undefined, signal?: AbortSignal): Promise<CalendarWeek> {
  // YYYY-MM-DD only; the server rejects any other shape rather than guessing.
  return api.get<CalendarWeek>(`/dashboard/calendar${date ? `?date=${date}` : ''}`, { signal });
}

export function calendarQuery(date?: string) {
  return {
    queryKey: ['dashboard', 'calendar', date ?? 'current'] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchCalendar(date, signal),
  };
}

// ── Insights ─────────────────────────────────────────────────────────────────

export interface InsightsReport {
  window: { from: string; to: string; weeks: number };
  heatmap: { date: string; count: number }[];
  /** Index 0 = Monday … 6 = Sunday. */
  byDayOfWeek: number[];
  /** Index 0–23, **UTC** — not the family's timezone. */
  byHourOfDay: number[];
  economy: {
    pointsEarned: number;
    pointsSpent: number;
    /** null when nothing has been spent — an infinity is not a ratio. */
    earnSpendRatio: number | null;
    currentBalance: number;
    /** Set when earning materially outpaces spending; null otherwise. */
    inflationWarning: string | null;
  };
  totals: { approved: number; activeDays: number };
}

/** `raw: true` — `/reports/*` does not use the envelope. See the module note. */
export function fetchInsights(weeks: number, signal?: AbortSignal): Promise<InsightsReport> {
  return api.get<InsightsReport>(`/reports/insights?weeks=${weeks}`, { signal, raw: true });
}

export function insightsQuery(weeks = 12) {
  return {
    queryKey: ['reports', 'insights', weeks] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchInsights(weeks, signal),
  };
}

export const INVALIDATED_BY_FAMILY_WRITE = [FAMILY_SETTINGS_KEY, FAMILY_KEY, PARENTS_KEY] as const;
