/**
 * clientTimestamp.ts — FR-13 (offline task queue)
 *
 * Children doing chores away from Wi-Fi tap Start/Complete offline; the action is queued on the
 * device and replayed when it reconnects. The replay may land minutes — or a night's sleep — after
 * the child actually did the work, so the client sends the moment it captured. Everything that is
 * time-sensitive downstream (the stored completedAt, the auto-approve elapsed-time ratio, and above
 * all the streak's calendar day) must run off that captured moment, not off the sync time.
 *
 * A client timestamp is attacker-controlled input: changing a phone's clock takes ten seconds and
 * a child has an obvious motive (farm a streak, or fake a plausible elapsed time). So it is
 * accepted only inside a window:
 *
 *   absent                       → server now (byte-for-byte the pre-FR-13 behaviour)
 *   more than 2 min in the FUTURE → rejected, 400. Future-dating is the streak-farming vector.
 *   0..2 min in the future        → clamped to now; that much is ordinary device clock drift.
 *   older than 48 h               → clamped to now − 48 h, so an ancient queue entry cannot be
 *                                   backdated into an arbitrary past day.
 *   otherwise                     → taken at face value.
 */

import { ValidationError } from '../middleware/errorHandler';

/** Tolerated forward clock drift before a timestamp is treated as a lie rather than a bad clock. */
export const CLIENT_CLOCK_SKEW_MS = 2 * 60 * 1000;

/** Oldest a queued action may claim to be. Older entries are clamped up to this age. */
export const CLIENT_TIMESTAMP_MAX_AGE_MS = 48 * 60 * 60 * 1000;

interface ResolveOptions {
  /** Field name used in the 400 body so the client knows which value was rejected. */
  field?: string;
  /** Injectable "now" — the caller may already have one, and tests need determinism. */
  now?: Date;
}

/**
 * Resolves a client-supplied ISO timestamp into the Date the server will act on.
 *
 * @throws ValidationError (HTTP 400) when the value is unparseable or meaningfully in the future.
 */
export function resolveClientTimestamp(
  raw: string | Date | null | undefined,
  options: ResolveOptions = {}
): Date {
  const field = options.field ?? 'timestamp';
  const now = options.now ?? new Date();

  if (raw === null || raw === undefined || raw === '') return now;

  const parsed = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    const message = `${field} must be a valid ISO-8601 datetime`;
    throw new ValidationError(message, [{ field, message }]);
  }

  const drift = parsed.getTime() - now.getTime();

  if (drift > CLIENT_CLOCK_SKEW_MS) {
    const message = `${field} cannot be in the future`;
    throw new ValidationError(message, [{ field, message }]);
  }

  // Small forward drift is a bad clock, not an attack — but never store a future instant.
  if (drift > 0) return now;

  if (-drift > CLIENT_TIMESTAMP_MAX_AGE_MS) {
    return new Date(now.getTime() - CLIENT_TIMESTAMP_MAX_AGE_MS);
  }

  return parsed;
}
