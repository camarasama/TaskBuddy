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
