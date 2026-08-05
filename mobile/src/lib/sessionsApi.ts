/**
 * Signed-in devices — the UI for P0-4, which has existed server-side and unused since Phase 0.
 *
 * Mobile sessions live up to 90 days, so a child's phone holds a long-lived credential. That is only
 * acceptable paired with a way to kill it on demand: a lost phone, a device handed on, a child who
 * should not be on the app after bedtime. Expiry alone is not a control — it is a wait.
 *
 * ## Two scopes, and the asymmetry is deliberate
 *
 * A parent may end **a child's** session but not **a co-parent's**. Co-parents are peers; "sign out my
 * kid's phone" does not imply "sign out the other adult in the house". The server enforces this — the
 * children endpoint scopes to `role: 'child'`, not to the family — and this module keeps the two calls
 * separate rather than parameterising one, so the distinction survives a refactor.
 *
 * ## The response is not an oracle
 *
 * Revoking an id that belongs to someone else returns the same 404 as one that does not exist. Do not
 * "improve" the error handling here into something that distinguishes them.
 */
import { api } from './api';

export interface DeviceSession {
  id: string;
  userId: string;
  /** `'web'` when the session was opened from a browser — the column is NULL for those. */
  client: string;
  userAgent: string | null;
  ipAddress: string | null;
  lastActiveAt: string | null;
  expiresAt: string;
  absoluteExpiresAt: string | null;
  /** True for the device making the request. Used to warn before someone signs themselves out. */
  isCurrent: boolean;
}

export interface SessionsResponse {
  sessions: DeviceSession[];
}

export const MY_SESSIONS_KEY = ['sessions', 'mine'] as const;
export const CHILD_SESSIONS_KEY = ['sessions', 'children'] as const;

export function fetchMySessions(signal?: AbortSignal): Promise<SessionsResponse> {
  return api.get<SessionsResponse>('/sessions', { signal });
}

export function fetchChildSessions(signal?: AbortSignal): Promise<SessionsResponse> {
  return api.get<SessionsResponse>('/sessions/children', { signal });
}

export function mySessionsQuery() {
  return {
    queryKey: MY_SESSIONS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchMySessions(signal),
    // A security control must not show a device that was signed out a minute ago as still live.
    staleTime: 0,
  };
}

export function childSessionsQuery() {
  return {
    queryKey: CHILD_SESSIONS_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchChildSessions(signal),
    staleTime: 0,
  };
}

/** End one of the caller's own sessions. */
export function revokeMySession(sessionId: string): Promise<unknown> {
  return api.delete(`/sessions/${sessionId}`);
}

/** End a child's session. Parent-only; the server rejects any id that is not a child's. */
export function revokeChildSession(sessionId: string): Promise<unknown> {
  return api.delete(`/sessions/children/${sessionId}`);
}

export const INVALIDATED_BY_REVOKE = [MY_SESSIONS_KEY, CHILD_SESSIONS_KEY] as const;

/**
 * A human label for a device.
 *
 * `client` is the `X-Client` string for native sessions (`taskbuddy-android/0.1.0`) and the literal
 * `'web'` for browsers. The user agent is long and mostly noise, so it is reduced to a rough platform
 * name — enough to tell two devices apart alongside the IP, which is the point.
 */
export function deviceLabel(session: DeviceSession): string {
  if (session.client.startsWith('taskbuddy-android')) return 'Android app';
  if (session.client !== 'web') return session.client;

  const ua = session.userAgent ?? '';
  if (/iPhone|iPad/i.test(ua)) return 'Browser on iPhone or iPad';
  if (/Android/i.test(ua)) return 'Browser on Android';
  if (/Windows/i.test(ua)) return 'Browser on Windows';
  if (/Mac OS/i.test(ua)) return 'Browser on Mac';
  if (/Linux/i.test(ua)) return 'Browser on Linux';
  return 'Browser';
}
