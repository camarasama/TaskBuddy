/**
 * Family members, for the parent's children screen.
 *
 * `GET /families/me/members` returns parents and children together, ordered parents-first. Filtering
 * happens here rather than in the screen so the shape a screen receives is already the thing it renders.
 *
 * ## Levels are read, never computed
 *
 * `childProfile.level` and `experiencePoints` are displayed exactly as the server sends them, and this
 * client deliberately does **not** derive a level or a "progress to next level" bar. There are
 * currently two different level formulas in the backend:
 *
 *   - `backend/src/utils/gamification.ts` — `BASE_XP * 1.5^(level-1)`, exponential, reading
 *     `totalXpEarned`. This is what `levelService` uses to set the stored `level`.
 *   - `backend/src/services/achievements.ts` — a cumulative sum of `BASE_XP * level^1.5`, polynomial,
 *     reading `experiencePoints` (which the schema documents as *resetting on level-up*).
 *
 * They describe different curves over different inputs. Until that is reconciled, any progress bar
 * drawn here would have to pick one and would be wrong against the other — and a lying progress bar in
 * a children's app is worse than no bar. Showing the server's own numbers cannot disagree with itself.
 */
import type { ChildProfile, User } from '@taskbuddy/shared';

import { api } from './api';

/** A family member as `/families/me/members` returns it. `childProfile` is absent for parents. */
export type FamilyMember = Omit<User, 'passwordHash'> & {
  childProfile?: ChildProfile;
};

/** A member narrowed to one that definitely has a child profile. */
export type ChildMember = FamilyMember & { childProfile: ChildProfile };

function isChild(member: FamilyMember): member is ChildMember {
  return member.role === 'child' && member.childProfile !== undefined;
}

export const CHILDREN_KEY = ['family', 'children'] as const;

/**
 * Children only, in the order the server returned them.
 *
 * A child row missing its profile is dropped rather than rendered with blank stats: every screen here
 * reads `childProfile`, and a half-populated card looks like a data-loss bug to a parent.
 */
export async function fetchChildren(signal?: AbortSignal): Promise<ChildMember[]> {
  const { members } = await api.get<{ members: FamilyMember[] }>('/families/me/members', { signal });
  return members.filter(isChild);
}

export function childrenQuery() {
  return {
    queryKey: CHILDREN_KEY,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchChildren(signal),
  };
}

// ── Vacation mode (growth roadmap §11.2) ─────────────────────────────────────

/**
 * Open or replace a child's streak pause.
 *
 * Dates are plain `YYYY-MM-DD`, matching the server's schema. Deliberately not ISO timestamps: a
 * holiday is a range of days, and sending a timestamp would make "which day did we fly home" depend
 * on the phone's timezone.
 *
 * The server enforces the rules that matter (forward-only, end not before start, at most 30 days) and
 * returns a readable message for each, so the screen surfaces the server's wording rather than
 * duplicating the rules and drifting from them.
 */
export async function setStreakPause(childId: string, from: string, until: string): Promise<void> {
  await api.put(`/families/me/children/${childId}/streak-pause`, { from, until });
}

export async function clearStreakPause(childId: string): Promise<void> {
  await api.delete(`/families/me/children/${childId}/streak-pause`);
}

/** The same range for every child, which is what a family holiday actually is. */
export async function setFamilyStreakPause(from: string, until: string): Promise<void> {
  await api.put('/families/me/streak-pause', { from, until });
}

// ── One-off grace grant (growth roadmap §11.3) ───────────────────────────────

/**
 * Hold this child's streak for a fixed window after one bad evening.
 *
 * No arguments beyond the child: the duration is `GRACE_GRANT_HOURS`, fixed, which is what keeps
 * this one tap at 9pm rather than a date-time picker. The server takes the LATER of this and the
 * family's standing grace policy, so granting can only ever extend the window.
 *
 * Returns the moment it expires so the screen can say when, rather than guessing it locally and
 * drifting from the server by the round-trip time.
 */
export async function grantGrace(childId: string): Promise<string> {
  const res = await api.post<{ childId: string; graceGrantedUntil: string }>(
    `/families/me/children/${childId}/grace-grant`,
  );
  return res.graceGrantedUntil;
}

export async function clearGrace(childId: string): Promise<void> {
  await api.delete(`/families/me/children/${childId}/grace-grant`);
}

/** `YYYY-MM-DD` in the device's own timezone, which is the one the parent is thinking in. */
export function toDayString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
