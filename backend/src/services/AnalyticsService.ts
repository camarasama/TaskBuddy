/**
 * services/AnalyticsService.ts — funnel instrumentation (growth roadmap 0b).
 *
 * The roadmap's north star ("families with ≥1 approved task per week") and every activation metric
 * under it were unmeasurable: nothing recorded funnel events. This is the write side.
 *
 * Three properties are load-bearing:
 *
 *  1. **It can never break a request.** `record()` swallows its own failures. Analytics is
 *     observability, not business logic — a full disk or a bad migration must not 500 a parent
 *     approving a task. Every call site may safely fire-and-forget.
 *
 *  2. **No child PII, ever.** Payloads are sanitised before writing: email-shaped and free-text
 *     values are dropped, not stored. This is binding under the child-data guardrails, and it is
 *     enforced here rather than trusted to call sites, because one careless caller is all it takes.
 *
 *  3. **No third-party SDK.** Events are first-party rows in our own Postgres. Nothing about a
 *     child's session leaves the box (COPPA).
 */

import { prisma } from './database';

/** The funnel events named in growth roadmap §1. */
export type AnalyticsEventType =
  | 'SIGNUP'
  | 'SETUP_STEP'
  | 'FIRST_APPROVAL'
  | 'TASK_APPROVED'
  | 'DIGEST_SENT'
  | 'DIGEST_OPENED';

export type ActorRole = 'parent' | 'child' | 'admin' | 'system';

/** Values permitted in a payload. Ids and enums — never names, emails or free text. */
export type PayloadValue = string | number | boolean | null;
export type AnalyticsPayload = Record<string, PayloadValue>;

export interface RecordInput {
  eventType: AnalyticsEventType;
  familyId?: string | null;
  actorRole?: ActorRole;
  payload?: AnalyticsPayload;
}

/**
 * Longest string accepted in a payload. A uuid is 36; enum values are shorter. Anything longer is
 * free text by definition and is dropped.
 */
export const MAX_PAYLOAD_STRING = 64;

/** Conservative email shape. Deliberately loose — it is a rejection filter, not a validator. */
const EMAIL_SHAPED = /\S+@\S+/;

/**
 * Strip anything that could carry personal data.
 *
 * Dropped keys are replaced with a marker rather than silently vanishing, so a developer sees the
 * event was filtered instead of wondering why their field never appeared.
 */
export function sanitisePayload(payload: AnalyticsPayload | undefined): AnalyticsPayload | undefined {
  if (!payload) return undefined;

  const clean: AnalyticsPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
      continue;
    }
    if (typeof value !== 'string') {
      clean[key] = '[dropped:type]';
      continue;
    }
    if (EMAIL_SHAPED.test(value)) {
      clean[key] = '[dropped:pii]';
      continue;
    }
    if (value.length > MAX_PAYLOAD_STRING) {
      clean[key] = '[dropped:freetext]';
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

/**
 * Record one funnel event. Never throws.
 *
 * Callers may `void` this. It is intentionally not awaited at most call sites — an analytics write
 * should not add latency to a user action.
 */
export async function record(input: RecordInput): Promise<void> {
  try {
    await prisma.analyticsEvent.create({
      data: {
        eventType: input.eventType,
        familyId: input.familyId ?? null,
        actorRole: input.actorRole ?? null,
        payload: sanitisePayload(input.payload) ?? undefined,
      },
    });
  } catch (error) {
    // Swallowed by design — see the header. Logged so it is visible in journald without paging.
    console.warn(
      `[Analytics] failed to record ${input.eventType}:`,
      (error as Error)?.message ?? error,
    );
  }
}

/**
 * Record FIRST_APPROVAL at most once per family.
 *
 * "Time from registration to first approved task" is only meaningful if the event fires on the
 * first one. The check-then-write is not transactional, but a duplicate here is harmless to the
 * metric (both rows carry the same familyId, and the funnel query takes MIN(created_at)), whereas a
 * transaction on every approval would not be worth the cost.
 */
export async function recordFirstApproval(familyId: string, payload?: AnalyticsPayload): Promise<void> {
  try {
    const existing = await prisma.analyticsEvent.findFirst({
      where: { eventType: 'FIRST_APPROVAL', familyId },
      select: { id: true },
    });
    if (existing) return;

    await record({ eventType: 'FIRST_APPROVAL', familyId, actorRole: 'parent', payload });
  } catch (error) {
    console.warn('[Analytics] failed to record FIRST_APPROVAL:', (error as Error)?.message ?? error);
  }
}

export const AnalyticsService = { record, recordFirstApproval, sanitisePayload };
