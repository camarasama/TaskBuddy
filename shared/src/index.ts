// Re-export all shared types and constants

export * from './types/models';
export * from './types/api';
export * from './types/admin';
export * from './types/reports';
export * from './types/games';
export * from './constants';
export * from './utils/difficultyFromPoints';

// ─── FR-18: outbound webhooks ────────────────────────────────────────────────
//
// The canonical event list is exactly the set of `notificationType` strings the backend passes to
// createNotification(), which is the single choke point webhook delivery hangs off. Keep them in
// sync: an event that is not listed here cannot be subscribed to by the API or the UI.
//
// Deliberately absent: `webhook_disabled`. That type is emitted BY the webhook auto-disable path
// itself, and letting it be subscribable would let a dead endpoint's disable notice trigger another
// dispatch round. WebhookService also hard-skips it at dispatch time as a second line of defence.

export const WEBHOOK_EVENTS = [
  'task_assigned',
  'task_submitted',
  'task_approved',
  'task_rejected',
  'task_expiring',
  'task_expired',
  'task_archived',
  'task_comment',
  'task_limit_reached',
  'reward_redeemed',
  'reward_fulfilled',
  'level_up',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** Human labels for the parent settings UI. */
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  task_assigned: 'Task assigned',
  task_submitted: 'Task submitted for approval',
  task_approved: 'Task approved',
  task_rejected: 'Task rejected',
  task_expiring: 'Task expiring soon',
  task_expired: 'Task expired',
  task_archived: 'Task archived',
  task_comment: 'New task comment',
  task_limit_reached: 'Daily task limit reached',
  reward_redeemed: 'Reward redeemed',
  reward_fulfilled: 'Reward fulfilled',
  level_up: 'Child levelled up',
};

/** Consecutive failed deliveries before a subscription is auto-disabled. */
export const WEBHOOK_MAX_CONSECUTIVE_FAILURES = 5;

/** A single recent-failure entry stored on the subscription (newest first, bounded). */
export interface WebhookFailureEntry {
  at: string;
  event: string;
  reason: string;
  status?: number;
}

/** Shape returned by the list endpoint — note there is no `secret` field, by design. */
export interface WebhookSubscriptionSummary {
  id: string;
  url: string;
  events: WebhookEvent[];
  isActive: boolean;
  failureCount: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  disabledAt: string | null;
  recentFailures: WebhookFailureEntry[];
  createdAt: string;
}
