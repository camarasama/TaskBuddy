// Shared constants

// Gamification constants
//
// There is deliberately NO `LEVEL` block here. It used to hold a polynomial curve
// (XP = BASE_XP * level^GROWTH_FACTOR) that disagreed with the exponential curve the backend
// actually levels children by, and the one consumer read it over the wrong field on top of that.
// The level curve has exactly one home: `xpRequiredForLevel` / `calculateLevelFromXp` in
// `backend/src/utils/gamification.ts`. Do not re-add a copy here.
export const GAMIFICATION = {
  // Streak bonuses
  STREAK: {
    MULTIPLIER: 0.05, // 5% bonus per streak day
    MAX_BONUS: 2.5, // 150% max bonus
    MILESTONES: [3, 7, 14, 30, 60, 100],
    MILESTONE_BONUS_PER_DAY: 5, // 5 points per milestone day
    DEFAULT_GRACE_PERIOD_HOURS: 4,
  },

  // Early completion bonuses
  EARLY_COMPLETION: {
    HOURS_48: 0.25, // 25% bonus
    HOURS_24: 0.15, // 15% bonus
    HOURS_12: 0.10, // 10% bonus
    HOURS_6: 0.05,  // 5% bonus
  },

  // Task XP values by difficulty
  TASK_XP: {
    easy: 10,
    medium: 20,
    hard: 35,
  },

  // Default points by difficulty
  DEFAULT_POINTS: {
    easy: 10,
    medium: 20,
    hard: 35,
  },
} as const;

// Validation constants
export const VALIDATION = {
  PIN: {
    LENGTH: 4,
    PATTERN: /^\d{4}$/,
  },
  PASSWORD: {
    MIN_LENGTH: 8,          // legacy floor (existing passwords, login)
    // Floor for NEW passwords (register/change/reset). F-10 set this to 10, which was our own
    // choice and not required by anything: NIST SP 800-63B and OWASP ASVS both put the minimum at
    // 8, GDPR Art. 32 and COPPA §312.8 name no length at all, and Play has no rule here. Lowered
    // to 8 on 2026-08-09 to sit exactly on that baseline. Kept as a separate constant from
    // MIN_LENGTH even though the values now match, because they answer different questions: this
    // one can be raised later without locking out parents already holding a valid 8-character
    // password, which is the whole reason the pair exists.
    NEW_MIN_LENGTH: 8,
    CHILD_MIN_LENGTH: 6,
  },
  USERNAME: {
    MIN_LENGTH: 3,
    MAX_LENGTH: 20,
    PATTERN: /^[a-zA-Z0-9_]+$/,
  },
  TASK_TITLE: {
    MIN_LENGTH: 3,
    MAX_LENGTH: 200,
  },
  POINTS: {
    MIN: 1,
    MAX: 1000,
  },
} as const;

// Rate limiting
export const RATE_LIMITS = {
  API: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 100,
  },
  AUTH: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_REQUESTS: 5,
  },
  UPLOAD: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 10,
  },
} as const;

// Upload limits
export const UPLOAD = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024, // 10MB
  MAX_COMPRESSED_SIZE_BYTES: 2 * 1024 * 1024, // 2MB
  MAX_DIMENSION: 2048,
  THUMBNAIL_SIZE: 300,
  ALLOWED_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
  ],
} as const;

// Task categories (default, families can customize)
export const DEFAULT_CATEGORIES = [
  'cleaning',
  'homework',
  'outdoor',
  'cooking',
  'pet-care',
  'personal-care',
  'helping',
  'other',
] as const;

// Notification types
export const NOTIFICATION_TYPES = {
  TASK_ASSIGNED: 'task_assigned',
  TASK_DUE_SOON: 'task_due_soon',
  TASK_COMPLETED: 'task_completed',
  TASK_APPROVED: 'task_approved',
  TASK_REJECTED: 'task_rejected',
  POINTS_EARNED: 'points_earned',
  REWARD_REDEEMED: 'reward_redeemed',
  ACHIEVEMENT_UNLOCKED: 'achievement_unlocked',
  LEVEL_UP: 'level_up',
  STREAK_AT_RISK: 'streak_at_risk',
  STREAK_BROKEN: 'streak_broken',
  SECURITY_ALERT: 'security_alert',
} as const;

// Consent document versions recorded on the CONSENT audit event (GDPR-K).
// Bump when the ToS or Privacy Policy materially changes so re-consent can be required.
export const CONSENT_VERSIONS = {
  tos: '1.0',
  privacy: '1.0',
  /**
   * The parental consent acknowledgement ticked on the create-child form.
   *
   * Versioned like the other two so that changing the wording can force a re-acknowledgement rather
   * than silently inheriting a tick against text nobody agreed to. Distinct from the family-wide
   * verifiable consent in `ConsentService`: that one proves a parent is who they say they are, this
   * one records that they read the statement for THIS child.
   */
  form: '1.0',
} as const;

/**
 * Age bounds, and the ONE implementation of the arithmetic behind them.
 *
 * These numbers were literals in ten places across four packages — `family.ts`, `auth.ts` twice, the
 * web children form (twice in validation and twice again in the input's min/max), the web register
 * form twice, and mobile. Ten copies of a product rule is ten chances for the server and a form to
 * disagree, and the symptom of that is a parent filling in a valid date and being rejected after
 * pressing the button.
 *
 * `isAgeBetween` exists for the same reason. Every one of those sites re-derived the same cutoff
 * dance with `setFullYear`, and the off-by-one-day cases (a birthday today, 29 February) are exactly
 * the kind of thing that gets written correctly in one place and subtly wrong in the other nine.
 */
export const AGE_LIMITS = {
  /** A child account: 10 to 16 inclusive. Tied to the Families policy, not a typo guard. */
  CHILD_MIN: 10,
  CHILD_MAX: 16,
  /** Parents and co-parents. Also the age at which a child ages out. */
  ADULT_MIN: 18,
} as const;

/**
 * Is someone born on `dateOfBirth` currently between `minYears` and `maxYears` inclusive?
 *
 * Pass `maxYears: null` for an open upper bound (adults). `now` is injectable so tests can pin a
 * date rather than depend on when they run — the boundary cases are the whole point of this
 * function and they are invisible on most days of the year.
 *
 * Returns false for anything unparseable, so a malformed string is a rejection rather than a throw.
 */
export function isAgeBetween(
  dateOfBirth: string | Date,
  minYears: number,
  maxYears: number | null,
  now: Date = new Date(),
): boolean {
  const born = dateOfBirth instanceof Date ? dateOfBirth : new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return false;

  // Latest permissible birth date: you must be at least `minYears` old, so you must have been born
  // on or before today-minus-minYears. Same-day birthdays count as having turned that age.
  const latest = new Date(now.getFullYear() - minYears, now.getMonth(), now.getDate());
  if (born > latest) return false;

  if (maxYears === null) return true;

  // Earliest permissible: you must not yet have had your (maxYears + 1)th birthday, so the day after
  // that birthday is the first excluded date.
  const earliest = new Date(now.getFullYear() - maxYears - 1, now.getMonth(), now.getDate());
  return born > earliest;
}

// Age groups
export const AGE_GROUPS = {
  YOUNGER: '10-12',
  OLDER: '13-16',
} as const;

export function getAgeGroup(birthDate: Date): '10-12' | '13-16' | null {
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }

  if (age >= 10 && age <= 12) return '10-12';
  if (age >= 13 && age <= 16) return '13-16';
  return null;
}

/**
 * FR-10: the avatar emoji a child can pick for themselves.
 *
 * Deliberately a fixed allow-list rather than free text. The field is child-controlled and shown to
 * the whole family, so an open string would be a small user-generated-content surface on an app for
 * 10-16 year olds. Backend validation and the picker grid both read this constant, so they cannot
 * drift apart.
 */
export const AVATAR_EMOJIS = [
  '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🦄',
  '🐙', '🦖', '🦋', '🐬', '🦉', '🐢', '🐝', '🦜',
  '⚽', '🎨', '🎸', '🚀', '⭐', '🌈', '🔥', '🍕',
] as const;

export type AvatarEmoji = (typeof AVATAR_EMOJIS)[number];

// Games taxonomy + economy (games redesign 2026-07-30) — kept in its own file, this one is long enough.
export * from './games';
