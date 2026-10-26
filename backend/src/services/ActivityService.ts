/**
 * services/ActivityService.ts - who is using the app, and when (admin insights, 2026-10-26).
 *
 * The owner chose "any real action" over "login only" as the meaning of active: the mobile app keeps
 * people signed in for months, so `lastLoginAt` badly undercounts. Every authenticated request calls
 * `touch()`, which records:
 *
 *   - users.last_active_at and families.last_active_at (drive the lifecycle stage),
 *   - one family_activity_days row per family per UTC day (history for DAU/WAU/MAU and cohorts),
 *   - reengagement_emails.returned_at for a recent email, so the dashboard can say which step
 *     brought a family back.
 *
 * It is on the hot path of every request, so it is throttled in memory (one write per user and per
 * family every THROTTLE_MS) and never awaited by the caller. A failure is logged and dropped: losing
 * a few minutes of activity is far better than failing a parent's request over analytics.
 *
 * Admins are not tracked; they have no family and would only pollute the numbers.
 */

import { prisma } from './database';

export const THROTTLE_MS = 10 * 60 * 1000;

/** Bounded so a long-running process cannot grow these without limit. */
const MAX_ENTRIES = 50_000;

const lastUserWrite = new Map<string, number>();
const lastFamilyWrite = new Map<string, number>();

function due(map: Map<string, number>, key: string, nowMs: number): boolean {
  const last = map.get(key);
  if (last !== undefined && nowMs - last < THROTTLE_MS) return false;
  if (map.size >= MAX_ENTRIES) map.clear();
  map.set(key, nowMs);
  return true;
}

/**
 * Jest suites mock `prisma` with only the models they use, so a write here would throw inside every
 * unrelated route test. Tracking is off under test unless a suite opts in.
 */
function enabled(): boolean {
  return process.env.NODE_ENV !== 'test' || process.env.ACTIVITY_TRACKING_IN_TESTS === 'true';
}

async function writeUser(userId: string, now: Date): Promise<void> {
  await prisma.$executeRaw`UPDATE users SET last_active_at = ${now} WHERE id = ${userId}`;
}

async function writeFamily(familyId: string, now: Date): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  await prisma.$executeRaw`
    INSERT INTO family_activity_days (family_id, day)
    VALUES (${familyId}, ${day}::date)
    ON CONFLICT DO NOTHING`;
  await prisma.$executeRaw`UPDATE families SET last_active_at = ${now} WHERE id = ${familyId}`;
  await prisma.$executeRaw`
    UPDATE reengagement_emails SET returned_at = ${now}
     WHERE family_id = ${familyId} AND returned_at IS NULL
       AND sent_at >= ${weekAgo} AND sent_at < ${now}`;
}

export const ActivityService = {
  /** Fire-and-forget. Safe to call on every request. */
  touch(params: { userId: string; familyId?: string | null; role: string; now?: Date }): void {
    if (!enabled() || params.role === 'admin') return;
    const now = params.now ?? new Date();
    const nowMs = now.getTime();

    const jobs: Promise<void>[] = [];
    if (due(lastUserWrite, params.userId, nowMs)) jobs.push(writeUser(params.userId, now));
    if (params.familyId && due(lastFamilyWrite, params.familyId, nowMs)) {
      jobs.push(writeFamily(params.familyId, now));
    }
    if (jobs.length === 0) return;

    Promise.all(jobs).catch((err) => {
      console.warn('[ActivityService] touch failed:', (err as Error)?.message);
    });
  },

  /** Test hook: forget the throttle state. */
  _reset(): void {
    lastUserWrite.clear();
    lastFamilyWrite.clear();
  },
};
