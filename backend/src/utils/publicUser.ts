/**
 * What of a user row may leave the API (security audit 2026-09-14).
 *
 * Responses used to strip `passwordHash` (and sometimes `mfaSecret`) and send everything else, so
 * `/auth/me`, login and the family member lists also carried the encrypted TOTP secret, the reset and
 * verification token hashes, and the lockout counters. None of it is directly usable, but none of it
 * belongs in a browser, a HAR file or a crash report either.
 *
 * One list, used everywhere a user row is returned. `tests/public-user-fields.test.ts` reads
 * `schema.prisma` and fails when a new column on User or ChildProfile has not been classified as
 * public or sensitive, so adding a secret column cannot silently start shipping it.
 */

export const SENSITIVE_USER_FIELDS = [
  'passwordHash',
  'mfaSecret',
  'emailVerificationToken',
  'emailVerificationExpiresAt',
  'passwordResetTokenHash',
  'passwordResetExpiresAt',
  'failedLoginAttempts',
  'lastFailedLoginAt',
  'lockedUntil',
] as const;

export const SENSITIVE_PROFILE_FIELDS = ['pinHash', 'pinResetTokenHash', 'pinResetExpiresAt'] as const;

type SensitiveUserField = (typeof SENSITIVE_USER_FIELDS)[number];
type SensitiveProfileField = (typeof SENSITIVE_PROFILE_FIELDS)[number];

export type PublicProfile<P> = Omit<P, SensitiveProfileField>;
export type PublicUser<U> = Omit<U, SensitiveUserField | 'childProfile'> &
  (U extends { childProfile: infer P }
    ? { childProfile: P extends object ? PublicProfile<P> : P }
    : unknown);

function omit(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) out[key] = value;
  }
  return out;
}

export function toPublicProfile<P extends object>(profile: P): PublicProfile<P>;
export function toPublicProfile<P extends object>(profile: P | null | undefined): PublicProfile<P> | null | undefined;
export function toPublicProfile<P extends object>(profile: P | null | undefined) {
  if (!profile) return profile;
  return omit(profile as Record<string, unknown>, SENSITIVE_PROFILE_FIELDS) as PublicProfile<P>;
}

export function toPublicUser<U extends object>(user: U): PublicUser<U> {
  const out = omit(user as Record<string, unknown>, SENSITIVE_USER_FIELDS);
  const profile = (user as { childProfile?: unknown }).childProfile;
  if (profile && typeof profile === 'object') out.childProfile = toPublicProfile(profile);
  return out as PublicUser<U>;
}
