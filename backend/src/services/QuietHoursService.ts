/**
 * services/QuietHoursService.ts — quiet hours and schooltime mode (growth roadmap §6).
 *
 * §11 lists *"quiet hours respected in push scheduling"* among the binding guardrails, and until now
 * nothing implemented it: `PushService.sendPush` fired at any hour of the night.
 *
 * Three decisions shape everything below.
 *
 * **Windows are evaluated in the family's timezone.** Not UTC, not server-local. A quiet-hours
 * feature that silences 20:00–07:00 UTC for a family in Denver is worse than no feature, because the
 * parent believes they are covered. `FamilySettings.timezone` is the source of truth, and an
 * unusable value degrades to UTC rather than throwing — a bad string must never stop notifications.
 *
 * **Only the push is suppressed.** The `Notification` row is still written and the socket event still
 * fires. This is about not buzzing a phone at 03:00, not about withholding information.
 *
 * **Nothing is queued for later.** Releasing a night's worth of held pushes at 07:00 would be a burst
 * of buzzes — a worse version of the problem being solved.
 */

import { prisma } from './database';

/** Minutes since local midnight, plus the ISO weekday (1 = Monday .. 7 = Sunday). */
export interface LocalClock {
  minutes: number;
  weekday: number;
}

export interface WindowSettings {
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  schooltimeEnabled: boolean;
  schooltimeStart: string;
  schooltimeEnd: string;
  schooltimeDays: number[];
}

export interface SuppressionDecision {
  suppressed: boolean;
  /** Present when suppressed. Logged, never shown to a user. */
  reason?: 'quiet_hours' | 'schooltime';
}

/** "HH:MM" → minutes since midnight. Returns null for anything unparseable. */
export function parseHm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? '');
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * The wall clock in `timeZone` at `now`.
 *
 * `Intl` is used rather than date arithmetic so DST is handled by the platform's own tz database.
 * An unknown zone throws `RangeError`; we fall back to UTC, because failing to resolve a timezone
 * must not take notification delivery down with it.
 */
export function localClock(now: Date, timeZone: string): LocalClock {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(now);

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = format(timeZone || 'UTC');
  } catch {
    parts = format('UTC');
  }

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  // 'en-GB' renders midnight as 24 in some ICU versions; normalise so 24:xx sorts before 01:00.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekday = weekdays.indexOf(get('weekday')) + 1;

  return { minutes: hour * 60 + minute, weekday: weekday > 0 ? weekday : 1 };
}

/**
 * Is `minutes` inside the window [start, end)?
 *
 * The wrapping case (20:00 → 07:00) is the *normal* one for quiet hours, not an edge case, so it is
 * handled first-class rather than as a correction. A window whose ends are equal covers nothing —
 * treating it as "all day" would silence a family completely off a typo.
 */
export function isWithinWindow(minutes: number, start: string, end: string): boolean {
  const from = parseHm(start);
  const to = parseHm(end);
  if (from === null || to === null || from === to) return false;

  return from < to
    ? minutes >= from && minutes < to
    : minutes >= from || minutes < to; // wraps past midnight
}

/**
 * Should a push to this user be held back right now?
 *
 * Pure, so the whole rule can be tested without a clock or a database.
 */
export function evaluateWindows(settings: WindowSettings, clock: LocalClock): SuppressionDecision {
  if (settings.quietHoursEnabled &&
      isWithinWindow(clock.minutes, settings.quietHoursStart, settings.quietHoursEnd)) {
    return { suppressed: true, reason: 'quiet_hours' };
  }

  // Schooltime only applies on its selected days — a Saturday morning is not school.
  if (settings.schooltimeEnabled &&
      settings.schooltimeDays.includes(clock.weekday) &&
      isWithinWindow(clock.minutes, settings.schooltimeStart, settings.schooltimeEnd)) {
    return { suppressed: true, reason: 'schooltime' };
  }

  return { suppressed: false };
}

/**
 * Database-backed check used by `PushService`.
 *
 * **Fails OPEN**, like U14's email cap: if the lookup errors, the push goes out. A silent, invisible
 * loss of notifications would be a worse bug than an ill-timed buzz.
 */
export async function isPushSuppressed(userId: string, now?: Date): Promise<SuppressionDecision> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        familyId: true,
        quietHoursEnabled: true,
        quietHoursStart: true,
        quietHoursEnd: true,
        schooltimeEnabled: true,
        schooltimeStart: true,
        schooltimeEnd: true,
        schooltimeDays: true,
      },
    });

    if (!user) return { suppressed: false };
    // The overwhelmingly common path: nobody has opted in, so no timezone lookup is needed.
    if (!user.quietHoursEnabled && !user.schooltimeEnabled) return { suppressed: false };

    const settings = user.familyId
      ? await prisma.familySettings.findUnique({
          where: { familyId: user.familyId },
          select: { timezone: true },
        })
      : null;

    return evaluateWindows(user, localClock(now ?? new Date(), settings?.timezone ?? 'UTC'));
  } catch (error) {
    console.warn('[QuietHoursService] check failed; allowing push:', (error as Error)?.message);
    return { suppressed: false };
  }
}

export const QuietHoursService = {
  isPushSuppressed,
  evaluateWindows,
  isWithinWindow,
  localClock,
  parseHm,
};
