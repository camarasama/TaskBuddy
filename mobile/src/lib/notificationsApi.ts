/**
 * Notifications — the in-app centre and the unread badge.
 *
 * ## Every call here is `raw: true`, and that is not incidental
 *
 * `/notifications/*` is the **only** part of the API that does not use the `{ success, data }`
 * envelope. Its handlers answer with bare objects and the web reads them that way. Through the
 * client's normal path those responses throw on a 200 — see the `raw` option in `api.ts`. Any new
 * call added to this module must pass it too.
 *
 * ## What is NOT here
 *
 * **Push.** `/notifications/push/subscribe` takes a *Web Push* subscription (endpoint + p256dh/auth
 * keys) produced by a browser's `PushManager`. A phone has no such object; native delivery needs FCM
 * and the `DevicePushToken` table, which is backend work P0-3 and gates Phase 4. Registering a device
 * against the web-push table would create rows nothing can ever deliver to, so this module
 * deliberately stops at reading and marking notifications.
 */
import type { Notification } from '@taskbuddy/shared';

import { api } from './api';
import type { PaginationMeta } from './tasksApi';

export interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
  total: number;
  pagination: PaginationMeta;
}

export const NOTIFICATIONS_KEY = ['notifications', 'list'] as const;
export const UNREAD_COUNT_KEY = ['notifications', 'unread'] as const;

export const NOTIFICATIONS_PAGE_SIZE = 20;

export function fetchNotifications(
  page: number,
  signal?: AbortSignal
): Promise<NotificationsResponse> {
  return api.get<NotificationsResponse>(
    `/notifications?page=${page}&limit=${NOTIFICATIONS_PAGE_SIZE}`,
    { signal, raw: true }
  );
}

export function fetchUnreadCount(signal?: AbortSignal): Promise<{ count: number }> {
  return api.get<{ count: number }>('/notifications/unread-count', { signal, raw: true });
}

export function markRead(id: string): Promise<unknown> {
  return api.put(`/notifications/${id}/read`, {}, { raw: true });
}

export function markAllRead(): Promise<unknown> {
  return api.put('/notifications/read-all', {}, { raw: true });
}

export function deleteNotification(id: string): Promise<unknown> {
  return api.delete(`/notifications/${id}`, { raw: true });
}

export function notificationsQuery() {
  return {
    queryKey: NOTIFICATIONS_KEY,
    queryFn: ({ pageParam, signal }: { pageParam: number; signal: AbortSignal }) =>
      fetchNotifications(pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last: NotificationsResponse) =>
      last.pagination.hasMore ? last.pagination.page + 1 : undefined,
    // A notification list that shows something already read, or misses one that just arrived, is
    // worse than a slightly chattier app.
    staleTime: 0,
  };
}

/**
 * The badge count, polled.
 *
 * Until push lands (P0-3 / Phase 4) there is no server→device channel, so the only way a phone learns
 * something happened is by asking. 60s is the compromise: frequent enough that a parent approving a
 * task is noticed within a minute, infrequent enough to matter neither to the battery nor to the
 * per-account rate limit (100 requests / 15 min — this spends 15 of them).
 *
 * `refetchOnWindowFocus` does the heavy lifting on top: reopening the app checks immediately, which
 * is when a child actually looks.
 */
export const UNREAD_POLL_MS = 60_000;

export function unreadCountQuery() {
  return {
    queryKey: UNREAD_COUNT_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchUnreadCount(signal),
    refetchInterval: UNREAD_POLL_MS,
    staleTime: 0,
  };
}

export const INVALIDATED_BY_NOTIFICATION_ACTION = [NOTIFICATIONS_KEY, UNREAD_COUNT_KEY] as const;

/**
 * Where a notification should take you, or null when it has no in-app destination.
 *
 * `actionUrl` is a **web** path (`/parent/approve/<id>`, `/child/tasks`) because that is what the
 * backend has always written for the browser. Mapping it here rather than following it blindly is the
 * point: a web path handed to expo-router either 404s or, worse, resolves to a route with the same
 * name in the wrong shell. Anything unrecognised returns null and the row simply does not navigate,
 * which is a better failure than landing somewhere arbitrary.
 */
export function destinationFor(
  notification: Pick<Notification, 'actionUrl' | 'notificationType'>,
  role: 'parent' | 'child'
): string | null {
  const url = notification.actionUrl ?? '';

  if (role === 'parent') {
    if (url.startsWith('/parent/approve') || url.includes('approve')) return '/(parent)/approvals';
    if (url.startsWith('/parent/tasks')) return '/(parent)/tasks';
    if (url.startsWith('/parent/children')) return '/(parent)/children';
    if (url.startsWith('/parent/rewards')) return '/(parent)/rewards';
    if (url.startsWith('/parent')) return '/(parent)/dashboard';
    return null;
  }

  if (url.startsWith('/child/tasks')) return '/(child)/tasks';
  if (url.startsWith('/child/rewards')) return '/(child)/rewards';
  if (url.startsWith('/child/games')) return '/(child)/games';
  if (url.startsWith('/child/achievements')) return '/(child)/me/achievements';
  if (url.startsWith('/child/leaderboard')) return '/(child)/me/leaderboard';
  if (url.startsWith('/child/recap')) return '/(child)/me/recap';
  if (url.startsWith('/child')) return '/(child)/dashboard';
  return null;
}
