/**
 * services/reengagementPolicy.ts - WHEN a re-engagement email is due. Pure, no I/O.
 *
 * Two tracks (owner-approved design, 2026-10-26):
 *
 *   setup  "Finish setting up"  For families with no approved task yet. Days count from SIGNUP.
 *   lapsed "We miss you"        For families that got going, then went quiet. Days count from the
 *                               LAST ACTIVITY.
 *
 * Each track is four emails; step 4 is the shared "should we keep your family's space?" goodbye.
 *
 * Rules, each one a guard against a specific bad email:
 *   - The latest DUE step is sent, never a backlog. A family that was silent for 40 days when this
 *     shipped gets the day-35 email, not days 14, 21 and 35 in a row.
 *   - Nothing is sent once a track's last day is more than LATE_GRACE_DAYS behind us. Long-churned
 *     families are left alone rather than surprised.
 *   - Steps are at least MIN_GAP_DAYS apart, whatever the schedule says.
 *   - Any activity ends an episode. For `lapsed` that is automatic (the anchor moves with the last
 *     activity, so the old episode's rows no longer match). For `setup` the anchor is the signup and
 *     never moves, so activity after the first email is checked explicitly.
 *   - A family gets at most one lapsed episode every LAPSED_REENTRY_DAYS, so someone who opens the app
 *     once a month is not emailed every month.
 */

export type Track = 'setup' | 'lapsed';

export const TRACKS: readonly Track[] = ['setup', 'lapsed'];

/** Day offsets of steps 1..4, from the track's anchor. */
export const TRACK_DAYS: Record<Track, readonly [number, number, number, number]> = {
  setup: [2, 5, 10, 21],
  lapsed: [14, 21, 35, 60],
};

export const LAST_STEP = 4;
export const MIN_GAP_DAYS = 3;
export const LATE_GRACE_DAYS = 7;
export const LAPSED_REENTRY_DAYS = 60;
/** A setup email never goes to a family that used the app in the last two days. */
export const SETUP_QUIET_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SentStep {
  track: Track;
  step: number;
  anchorAt: Date;
  sentAt: Date;
}

export interface FamilyState {
  createdAt: Date;
  /** Null for a family created before activity tracking with nothing to backfill from. */
  lastActiveAt: Date | null;
  /** Has at least one approved task, ever. */
  activated: boolean;
  sent: SentStep[];
}

export interface Episode {
  track: Track;
  anchorAt: Date;
}

export interface Plan extends Episode {
  /** Steps already sent in this episode, ascending. */
  sentSteps: number[];
  lastSentAt: Date | null;
  /** The step that would go next, or null when the episode is finished. */
  nextStep: number | null;
  /** When the scheduled job will send `nextStep`. Null when nothing is left. */
  nextDueAt: Date | null;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function inEpisode(sent: SentStep[], ep: Episode): SentStep[] {
  return sent
    .filter((s) => s.track === ep.track && s.anchorAt.getTime() === ep.anchorAt.getTime())
    .sort((a, b) => a.step - b.step);
}

/**
 * Which track and episode applies to this family right now, or null when none does.
 *
 * `ignoreQuiet` is for the admin's "send next now", which is a deliberate human decision and may go
 * to a family that was active yesterday.
 */
export function currentEpisode(f: FamilyState, now: Date, opts: { ignoreQuiet?: boolean } = {}): Episode | null {
  const lastActive = f.lastActiveAt ?? f.createdAt;

  if (!f.activated) {
    const ep: Episode = { track: 'setup', anchorAt: f.createdAt };
    const rows = inEpisode(f.sent, ep);
    // They came back after we first wrote: the email did its job, the episode is over.
    if (rows.length > 0 && lastActive.getTime() > rows[0].sentAt.getTime()) return null;
    if (!opts.ignoreQuiet && daysBetween(lastActive, now) < SETUP_QUIET_DAYS) return null;
    return ep;
  }

  const ep: Episode = { track: 'lapsed', anchorAt: lastActive };
  const otherEpisodeRecently = f.sent.some(
    (s) =>
      s.track === 'lapsed' &&
      s.anchorAt.getTime() !== lastActive.getTime() &&
      now.getTime() - s.sentAt.getTime() < LAPSED_REENTRY_DAYS * DAY_MS,
  );
  if (otherEpisodeRecently) return null;
  return ep;
}

/** The step the scheduled job should send now, or null. */
export function dueStep(ep: Episode, sentInEpisode: SentStep[], now: Date): number | null {
  const days = TRACK_DAYS[ep.track];
  const elapsed = daysBetween(ep.anchorAt, now);
  if (elapsed > days[LAST_STEP - 1] + LATE_GRACE_DAYS) return null;

  let due = 0;
  days.forEach((d, i) => {
    if (d <= elapsed) due = i + 1;
  });
  if (due === 0) return null;

  const maxSent = sentInEpisode.reduce((m, s) => Math.max(m, s.step), 0);
  if (due <= maxSent) return null;

  const last = sentInEpisode[sentInEpisode.length - 1];
  if (last && now.getTime() - last.sentAt.getTime() < MIN_GAP_DAYS * DAY_MS) return null;

  return due;
}

/** Full picture for the admin table: where the family is in its sequence and what comes next. */
export function planFor(f: FamilyState, now: Date, opts: { ignoreQuiet?: boolean } = {}): Plan | null {
  const ep = currentEpisode(f, now, opts);
  if (!ep) return null;
  const rows = inEpisode(f.sent, ep);
  const sentSteps = rows.map((r) => r.step);
  const lastSentAt = rows.length ? rows[rows.length - 1].sentAt : null;
  const maxSent = sentSteps.length ? sentSteps[sentSteps.length - 1] : 0;

  const days = TRACK_DAYS[ep.track];
  const finalDeadline = ep.anchorAt.getTime() + (days[LAST_STEP - 1] + LATE_GRACE_DAYS) * DAY_MS;
  if (maxSent >= LAST_STEP || now.getTime() > finalDeadline) {
    return { ...ep, sentSteps, lastSentAt, nextStep: null, nextDueAt: null };
  }

  // The next step the schedule will reach. A late start skips ahead to the latest due step.
  const due = dueStep(ep, rows, now);
  const nextStep = due ?? maxSent + 1;
  const scheduled = ep.anchorAt.getTime() + days[nextStep - 1] * DAY_MS;
  const gapOk = lastSentAt ? lastSentAt.getTime() + MIN_GAP_DAYS * DAY_MS : 0;
  const nextDueAt = new Date(Math.max(scheduled, gapOk, due ? now.getTime() : 0));
  return { ...ep, sentSteps, lastSentAt, nextStep, nextDueAt };
}

/** For "send next now": the step after the last one sent, ignoring the calendar. */
export function nextManualStep(sentInEpisode: SentStep[]): number | null {
  const maxSent = sentInEpisode.reduce((m, s) => Math.max(m, s.step), 0);
  return maxSent < LAST_STEP ? maxSent + 1 : null;
}

export { inEpisode as stepsInEpisode };
