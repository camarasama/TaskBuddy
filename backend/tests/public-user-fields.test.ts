import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SENSITIVE_PROFILE_FIELDS,
  SENSITIVE_USER_FIELDS,
  toPublicProfile,
  toPublicUser,
} from '../src/utils/publicUser';

/**
 * Which user columns may leave the API (security audit 2026-09-14).
 *
 * Responses used to strip only `passwordHash`, so `/auth/me`, login and the family lists also sent the
 * encrypted TOTP secret, reset and verification token hashes and the lockout counters. The strip list
 * now lives in one place, and the guard below makes every NEW column a decision: it fails until the
 * column is listed here as public or in `utils/publicUser.ts` as sensitive.
 */

const PUBLIC_USER_FIELDS = [
  'id', 'familyId', 'email', 'username', 'role', 'firstName', 'lastName', 'avatarUrl', 'gender',
  'isPrimaryParent', 'dateOfBirth', 'phone', 'isActive', 'lastLoginAt', 'emailVerifiedAt',
  'mfaEnabledAt', 'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd', 'schooltimeEnabled',
  'schooltimeStart', 'schooltimeEnd', 'schooltimeDays', 'createdAt', 'updatedAt', 'deletedAt',
];

const PUBLIC_PROFILE_FIELDS = [
  'id', 'userId', 'dateOfBirth', 'ageGroup', 'pointsBalance', 'totalPointsEarned',
  'totalTasksCompleted', 'currentStreakDays', 'longestStreakDays', 'streakFreezes',
  'streakPausedFrom', 'streakPausedUntil', 'graceGrantedUntil', 'lastStreakDate', 'lastActivityDate',
  'level', 'experiencePoints', 'totalXpEarned', 'avatarEmoji', 'pendingAvatarUrl', 'pendingAvatarAt',
  'createdAt', 'updatedAt',
];

/** Scalar columns of a Prisma model: skips relations (capitalised model types) and attributes. */
function scalarFields(model: string): string[] {
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const block = new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  if (!block) throw new Error(`model ${model} not found`);
  const scalars = new Set(['String', 'Int', 'Boolean', 'DateTime', 'Float', 'Decimal', 'Json', 'BigInt', 'Bytes']);
  const enums = new Set([...schema.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]));
  return block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'))
    .map((line) => line.split(/\s+/))
    .filter(([, type]) => {
      const base = (type ?? '').replace(/[?[\]]/g, '');
      return scalars.has(base) || enums.has(base);
    })
    .map(([name]) => name);
}

describe('every User and ChildProfile column is classified', () => {
  it('User', () => {
    const classified = new Set([...PUBLIC_USER_FIELDS, ...SENSITIVE_USER_FIELDS]);
    expect(scalarFields('User').filter((f) => !classified.has(f))).toEqual([]);
  });

  it('ChildProfile', () => {
    const classified = new Set([...PUBLIC_PROFILE_FIELDS, ...SENSITIVE_PROFILE_FIELDS]);
    expect(scalarFields('ChildProfile').filter((f) => !classified.has(f))).toEqual([]);
  });
});

describe('toPublicUser', () => {
  const row = {
    id: 'u1',
    email: 'sam@example.com',
    firstName: 'Sam',
    mfaEnabledAt: new Date(),
    passwordHash: 'bcrypt',
    mfaSecret: 'aes-gcm-ciphertext',
    emailVerificationToken: 'sha',
    emailVerificationExpiresAt: new Date(),
    passwordResetTokenHash: 'sha',
    passwordResetExpiresAt: new Date(),
    failedLoginAttempts: 3,
    lastFailedLoginAt: new Date(),
    lockedUntil: new Date(),
    family: { id: 'f1', familyName: 'Taylor' },
    childProfile: { pointsBalance: 120, pinHash: 'bcrypt', pinResetTokenHash: 'sha', pinResetExpiresAt: new Date() },
  };

  it('removes every sensitive field, at both levels', () => {
    const out = toPublicUser(row) as Record<string, any>;
    for (const f of SENSITIVE_USER_FIELDS) expect(out).not.toHaveProperty(f);
    for (const f of SENSITIVE_PROFILE_FIELDS) expect(out.childProfile).not.toHaveProperty(f);
  });

  it('keeps what the apps read', () => {
    const out = toPublicUser(row) as Record<string, any>;
    expect(out).toMatchObject({ id: 'u1', email: 'sam@example.com', firstName: 'Sam', family: { familyName: 'Taylor' } });
    expect(out.mfaEnabledAt).toBeInstanceOf(Date); // the settings screen shows whether 2FA is on
    expect(out.childProfile).toEqual({ pointsBalance: 120 });
  });

  it('passes null profiles through', () => {
    expect(toPublicProfile(null)).toBeNull();
    expect((toPublicUser({ id: 'p', childProfile: null }) as any).childProfile).toBeNull();
  });
});
