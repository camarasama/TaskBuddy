import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from './database';
import { config } from '../config';
import { SessionService, type SessionContext } from './SessionService';
import { AuditService } from './AuditService';
import { AnalyticsService } from './AnalyticsService';
import { generateReferralCode, resolveReferrer } from './ReferralService';
import { EmailService } from './email';
import { jwtVerifyOptions, jwtSignOptions } from '../utils/jwt';
import { encryptSecret, decryptSecret, generateMfaSecret, mfaKeyUri, verifyMfaCode } from '../utils/mfa';
import {
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  ValidationError,
  ForbiddenError,
} from '../middleware/errorHandler';
import type { TokenPayload } from '../middleware/auth';
import { getAgeGroup } from '@taskbuddy/shared';
import { generateFamilyCode } from '../utils/familyCode';

const SALT_ROUNDS = 12;

// Password-reset links are single-use and short-lived: a leaked reset email should not remain
// actionable for long.
const PASSWORD_RESET_TTL_MS = 60 * 60_000; // 1 hour

// Compared against when no child matches, so an unknown identifier costs the same bcrypt work
// as a real one. Must be a *valid* cost-SALT_ROUNDS hash (of a discarded random value) — a
// malformed placeholder can be rejected early, which reintroduces the timing signal.
const DUMMY_PIN_HASH = '$2b$12$EyVh6/LfhPIbYirhFUUBsOgDr0YQGNrAuZ/EgL6CrOBsrhfRRLtY2';

// Credentials here are weak by design (child PINs are 4 digits), so an unthrottled account is
// brute-forceable and *some* lockout is required. But locking on the first failure let anyone
// who knew a family code and a child's first name keep that child permanently locked out with
// one request every 15 minutes. So: tolerate the first few failures (people mistype), then
// back off steeply.
const LOGIN_LOCKOUT_THRESHOLD = 4;
const LOGIN_LOCKOUT_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

// Consecutive-failure counts decay, so someone who fumbles their credentials a few times
// months apart is not treated as an attacker mid-run.
const LOGIN_ATTEMPT_DECAY_MS = 60 * 60_000;

/** Lock duration for the nth consecutive failed login; 0 means "do not lock yet". */
function loginLockoutMs(attempts: number): number {
  if (attempts <= LOGIN_LOCKOUT_THRESHOLD) return 0;
  const step = attempts - LOGIN_LOCKOUT_THRESHOLD - 1;
  return LOGIN_LOCKOUT_BACKOFF_MS[Math.min(step, LOGIN_LOCKOUT_BACKOFF_MS.length - 1)];
}

type LockoutState = {
  id: string;
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
  // Optional context, used only to alert parents when a child account locks (F-8).
  role?: string;
  familyId?: string | null;
  firstName?: string;
};

/**
 * Email the family's parents that a child account was just locked (F-8). Fire-and-forget: a mail
 * failure must never break or delay the login response, so callers do not await this.
 */
async function notifyParentsOfChildLock(
  familyId: string,
  childName: string,
  lockMs: number,
): Promise<void> {
  const lockMinutes = Math.max(1, Math.round(lockMs / 60_000));
  try {
    await EmailService.sendToFamilyParents({
      familyId,
      triggerType: 'child_locked',
      subjectBuilder: () => `${childName}'s TaskBuddy account was temporarily locked`,
      templateData: { parentFirstName: 'there', childName, lockMinutes },
      referenceType: 'child_lockout',
    });
  } catch (err) {
    console.error('[auth] child-lock parent notification failed:', (err as Error)?.message);
  }
}

/** Record a failed login, locking the account once failures pass the threshold. */
async function recordFailedLogin(user: LockoutState): Promise<void> {
  const now = Date.now();
  const stale =
    !user.lastFailedLoginAt || now - user.lastFailedLoginAt.getTime() > LOGIN_ATTEMPT_DECAY_MS;
  const attempts = stale ? 1 : user.failedLoginAttempts + 1;
  const lockMs = loginLockoutMs(attempts);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: attempts,
      lastFailedLoginAt: new Date(now),
      ...(lockMs > 0 ? { lockedUntil: new Date(now + lockMs) } : {}),
    },
  });

  // Alert parents only on the transition into a locked state (the first attempt past the
  // threshold), and only for children — not on every subsequent failure while already locked.
  const justLocked = attempts === LOGIN_LOCKOUT_THRESHOLD + 1;
  if (justLocked && user.role === 'child' && user.familyId) {
    void notifyParentsOfChildLock(user.familyId, user.firstName ?? 'Your child', lockMs);
  }
}

/** Fields cleared on a successful login, so a lock never outlives the credentials proving it. */
const CLEAR_LOCKOUT = { lockedUntil: null, failedLoginAttempts: 0, lastFailedLoginAt: null };

export interface RegisterInput {
  familyName: string;
  parent: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    gender?: string;
  };
  /** U20 — optional cross-family referral code. An unusable one is ignored, never fatal. */
  referralCode?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ChildLoginInput {
  familyCode: string;       // ADJECTIVE-ANIMAL-NNNN format (case-insensitive)
  childIdentifier: string;
  pin: string;
  deviceId?: string;
}

export interface AddChildInput {
  familyId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date;
  /** Required: this is the child's login handle. Unique within the family, stored lowercased. */
  username: string;
  pin?: string;
  createdBy: string;
  email?: string;
  gender?: string;
}

export class AuthService {
  // Register a new family with parent account
  async register(input: RegisterInput, ctx: SessionContext = {}) {
    const { familyName, parent } = input;

    // Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: parent.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictError('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(parent.password, SALT_ROUNDS);

    // Generate a unique memorable family code before the transaction
    const familyCode = await generateFamilyCode();

    // U20 — resolve the referral before the transaction. Self-referral is impossible here (the
    // family does not exist yet) and an unknown code resolves to null rather than throwing: a
    // mistyped referral must never cost a signup.
    const referredByFamilyId = await resolveReferrer(input.referralCode);

    // Create family and parent user in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create family with memorable code
      const family = await tx.family.create({
        data: {
          familyName,
          familyCode,
          referralCode: generateReferralCode(),
          // Write-once: set here at signup and never updated, so credit cannot be re-attributed.
          referredByFamilyId,
        },
      });

      // Create parent user - first parent is always the primary parent (M4: isPrimaryParent)
      const user = await tx.user.create({
        data: {
          familyId: family.id,
          email: parent.email.toLowerCase(),
          passwordHash,
          role: 'parent',
          isPrimaryParent: true,
          firstName: parent.firstName,
          lastName: parent.lastName,
          ...(parent.gender ? { gender: parent.gender } : {}),
        },
      });

      // Create default family settings
      await tx.familySettings.create({
        data: { familyId: family.id },
      });

      return { family, user };
    });

    // Generate tokens (parent uses standard expiry)
    const tokens = this.generateTokens(
      {
        userId: result.user.id,
        familyId: result.family.id,
        role: result.user.role,
      },
      { isMobile: ctx.isMobile }
    );
    await SessionService.create(result.user.id, tokens.refreshToken, { ...ctx, isChild: false });

    // U20 — family ids only. AnalyticsService drops anything that looks like free text or an
    // email, so there is nothing identifying in here even if the shape changes later.
    if (referredByFamilyId) {
      void AnalyticsService.record({
        eventType: 'REFERRAL_SIGNUP',
        familyId: result.family.id,
        actorRole: 'parent',
        payload: { referredBy: referredByFamilyId },
      });
    }

    // Remove sensitive data
    const { passwordHash: _, ...userWithoutPassword } = result.user;

    return {
      family: result.family,
      user: userWithoutPassword,
      tokens,
    };
  }

  // Parent login with email/password
  async login(input: LoginInput, ctx: SessionContext = {}) {
    const { email, password } = input;

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        family: true,
        childProfile: true,
      },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedError('Account is temporarily locked. Please try again later.');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      // Without this the lockedUntil check above was dead code — nothing ever set it for
      // parents, so password guessing was bounded only by the per-IP authLimiter.
      await recordFailedLogin(user);
      throw new UnauthorizedError('Invalid email or password');
    }

    // Update last login, clearing any accumulated failures
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), ...CLEAR_LOCKOUT },
    });

    // F-9 / FR-17: any MFA-enrolled account (admins since F-9, parents since FR-17) must clear a
    // TOTP challenge before receiving a session. Children have no password login, so they never
    // reach here; keying on mfaEnabledAt alone is therefore correct and role-agnostic.
    if (user.mfaEnabledAt) {
      const { passwordHash: _p, mfaSecret: _s, ...safe } = user;
      return { mfaRequired: true as const, user: safe };
    }

    return this.issueSession(user, ctx);
  }

  /** Mint tokens + create the refresh session for an already-authenticated user. */
  private async issueSession(user: any, ctx: SessionContext) {
    const tokens = this.generateTokens(
      {
        userId: user.id,
        familyId: user.familyId!,
        role: user.role,
        ageGroup: user.childProfile?.ageGroup || undefined,
      },
      { isMobile: ctx.isMobile }
    );
    await SessionService.create(user.id, tokens.refreshToken, { ...ctx, isChild: false });
    const { passwordHash: _, mfaSecret: _s, ...userWithoutPassword } = user;
    return { user: userWithoutPassword, profile: user.childProfile, tokens };
  }

  /** Begin MFA enrollment: generate + store an encrypted (not-yet-enabled) secret, return the URI. */
  async setupMfa(userId: string): Promise<{ otpauthUrl: string }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    // FR-17: parents may enrol too. Children authenticate by PIN and cannot use TOTP.
    if (!user || (user.role !== 'admin' && user.role !== 'parent')) {
      throw new UnauthorizedError('Only parents and admins can enable two-factor authentication');
    }
    const secret = generateMfaSecret();
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encryptSecret(secret), mfaEnabledAt: null }, // stays disabled until verified
    });
    return { otpauthUrl: mfaKeyUri(user.email ?? user.id, secret) };
  }

  /** Finish MFA enrollment: verify the first code, then mark MFA enabled. */
  async confirmMfa(userId: string, code: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaSecret) throw new ValidationError('Start MFA setup first');
    if (!verifyMfaCode(decryptSecret(user.mfaSecret), code)) {
      throw new UnauthorizedError('Invalid authentication code');
    }
    await prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: new Date() } });
  }

  /**
   * Complete an admin MFA login: verify the TOTP code against the stored secret and, on success,
   * issue a real session. Throws UnauthorizedError on any failure.
   */
  async verifyMfaAndLogin(userId: string, code: string, ctx: SessionContext = {}) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { family: true, childProfile: true },
    });
    // FR-17: admins and parents both reach the challenge; children never enrol.
    if (!user || !user.mfaEnabledAt || !user.mfaSecret) {
      throw new UnauthorizedError('MFA is not enabled for this account');
    }
    if (!verifyMfaCode(decryptSecret(user.mfaSecret), code)) {
      throw new UnauthorizedError('Invalid authentication code');
    }
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issueSession(user, ctx);
  }

  /**
   * Disable MFA on an account (FR-17). Requires a valid current TOTP code, so a hijacked session
   * cannot silently strip the second factor off. An admin cannot disable while the deployment
   * mandates admin MFA (`config.mfa.required`) — that policy is enforced here, not just in the UI.
   */
  async disableMfa(userId: string, code: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.mfaEnabledAt || !user.mfaSecret) {
      throw new ValidationError('Two-factor authentication is not enabled on this account.');
    }
    if (user.role === 'admin' && config.mfa.required) {
      throw new ForbiddenError('Two-factor authentication is mandatory for admins and cannot be disabled.');
    }
    if (!verifyMfaCode(decryptSecret(user.mfaSecret), code)) {
      throw new UnauthorizedError('Invalid authentication code');
    }
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaEnabledAt: null },
    });
  }

  // Child login with family code (ADJECTIVE-ANIMAL-NNNN) and PIN
  async childLogin(input: ChildLoginInput, ctx: SessionContext = {}) {
    const { familyCode, childIdentifier, pin } = input;

    // Resolve family by memorable code (case-insensitive)
    const family = await prisma.family.findFirst({
      where: {
        familyCode: {
          equals: familyCode.toUpperCase(),
          mode: 'insensitive',
        },
        deletedAt: null,
      },
      select: { id: true },
    });

    // Only look up the child when the family exists; an unknown family code falls through to the
    // same dummy compare and the same generic error below. A distinct "Family not found" reply
    // (F-10d) revealed which family codes are real, both by its message and by returning before
    // the bcrypt work.
    // Match on username ONLY. This used to also match firstName, which made the lookup ambiguous
    // for two siblings sharing a name: findFirst returned an arbitrary one, so the other child
    // could never log in and each of her attempts counted a failure against her sibling's
    // account. Usernames are unique per family and stored lowercased, so an exact match on the
    // lowercased input is both unambiguous and index-friendly.
    const user = family
      ? await prisma.user.findFirst({
          where: {
            familyId: family.id,
            role: 'child',
            deletedAt: null,
            username: childIdentifier.trim().toLowerCase(),
          },
          include: {
            childProfile: true,
          },
        })
      : null;

    // Check lockout before expensive bcrypt call
    if (user && user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedError('Account is temporarily locked');
    }

    // Always run bcrypt to prevent timing-based enumeration. The compare must happen
    // unconditionally — short-circuiting on a missing family/user returns measurably faster and
    // leaks which (familyCode, childIdentifier) pairs exist.
    const pinHash = user?.childProfile?.pinHash ?? DUMMY_PIN_HASH;
    const pinMatches = await bcrypt.compare(pin, pinHash);
    const isValid = !!(family && user?.childProfile) && pinMatches;

    if (!family || !user || !user.childProfile || !isValid) {
      if (user) {
        // Count the failure, and only lock once the attempts look like guessing rather
        // than a child fat-fingering their PIN. See LOGIN_LOCKOUT_BACKOFF_MS.
        await recordFailedLogin(user);
      }
      throw new UnauthorizedError('Invalid credentials');
    }

    // Clear lockout + failure count, and record successful login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), ...CLEAR_LOCKOUT },
    });

    // Generate tokens with child-specific expiry (90d refresh, 24h access)
    const tokens = this.generateChildTokens({
      userId: user.id,
      familyId: user.familyId!,
      role: user.role,
      ageGroup: user.childProfile.ageGroup || undefined,
    });
    await SessionService.create(user.id, tokens.refreshToken, {
      ...ctx,
      isChild: true,
      deviceId: input.deviceId, // F-10g: persist the child-login device id for traceability
    });

    // Remove sensitive data
    const { passwordHash: _, ...userWithoutPassword } = user;
    const { pinHash: __, ...profileWithoutPin } = user.childProfile;

    return {
      user: userWithoutPassword,
      profile: profileWithoutPin,
      tokens,
    };
  }

  // Regenerate the family code for a given family (parent action)
  async regenerateFamilyCode(familyId: string, parentId: string): Promise<string> {
    // Verify requester is a parent in this family
    const parent = await prisma.user.findUnique({
      where: { id: parentId },
    });

    if (!parent || parent.familyId !== familyId || parent.role !== 'parent') {
      throw new UnauthorizedError('Not authorized to regenerate family code');
    }

    const newCode = await generateFamilyCode();

    await prisma.family.update({
      where: { id: familyId },
      data: { familyCode: newCode },
    });

    return newCode;
  }

  // Add a child to the family
  async addChild(input: AddChildInput) {
    const { familyId, firstName, lastName, dateOfBirth, username, pin, createdBy, email, gender } = input;

    // Verify creator is parent in same family
    const creator = await prisma.user.findUnique({
      where: { id: createdBy },
    });

    if (!creator || creator.familyId !== familyId || creator.role !== 'parent') {
      throw new UnauthorizedError('Not authorized to add children to this family');
    }

    // The username is the child's login handle, so it is mandatory. It is unique within the
    // FAMILY, not globally — the old check was global, which meant one family taking "sam"
    // permanently blocked every other family from using it.
    const normalizedUsername = username?.trim().toLowerCase();
    if (!normalizedUsername) {
      throw new ValidationError('Username is required');
    }
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
      throw new ValidationError(
        'Username must be 3-20 characters, using only letters, numbers or underscores',
      );
    }

    const existingUsername = await prisma.user.findFirst({
      where: { familyId, username: normalizedUsername },
    });
    if (existingUsername) {
      throw new ConflictError('That username is already taken in this family');
    }

    // Determine age group
    const ageGroup = getAgeGroup(dateOfBirth);
    if (!ageGroup) {
      throw new ValidationError('Child must be between 10-16 years old');
    }

    // Hash PIN if provided
    let pinHash: string | undefined;
    if (pin) {
      if (!/^\d{4}$/.test(pin)) {
        throw new ValidationError('PIN must be exactly 4 digits');
      }
      pinHash = await bcrypt.hash(pin, SALT_ROUNDS);
    }

    // Create child user and profile
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          familyId,
          role: 'child',
          firstName,
          lastName,
          username: normalizedUsername,
          ...(email ? { email: email.toLowerCase() } : {}),
          ...(gender ? { gender } : {}),
        },
      });

      const profile = await tx.childProfile.create({
        data: {
          userId: user.id,
          dateOfBirth,
          ageGroup: ageGroup === '10-12' ? 'YOUNGER' : 'OLDER',
          pinHash,
        },
      });

      return { user, profile };
    });

    // Remove sensitive data
    const { pinHash: _, ...profileWithoutPin } = result.profile;

    return {
      user: result.user,
      profile: profileWithoutPin,
    };
  }

  // Set up PIN for a child
  async setupPin(childId: string, pin: string, parentId: string) {
    // Verify parent owns this child
    const [child, parent] = await Promise.all([
      prisma.user.findUnique({
        where: { id: childId },
        include: { childProfile: true },
      }),
      prisma.user.findUnique({
        where: { id: parentId },
      }),
    ]);

    if (!child || !child.childProfile) {
      throw new NotFoundError('Child not found');
    }

    if (!parent || child.familyId !== parent.familyId || parent.role !== 'parent') {
      throw new UnauthorizedError('Not authorized to set PIN for this child');
    }

    // Validate PIN format
    if (!/^\d{4}$/.test(pin)) {
      throw new ValidationError('PIN must be exactly 4 digits');
    }

    // Hash and store PIN
    const pinHash = await bcrypt.hash(pin, SALT_ROUNDS);
    await prisma.childProfile.update({
      where: { userId: childId },
      data: { pinHash },
    });

    // A new/changed PIN invalidates the child's existing sessions, so a device that knew the old
    // PIN (or a lingering token) cannot keep acting as the child after a parent resets it.
    await SessionService.revokeAllForUser(childId, 'pin_reset');
  }

  // Change password for parent user
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.passwordHash) {
      throw new NotFoundError('User not found');
    }

    if (user.role !== 'parent') {
      throw new UnauthorizedError('Only parents can change passwords');
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Hash and save new password
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // Changing the password kills every existing session - a stolen refresh token must not
    // outlive the credential the user just rotated.
    await SessionService.revokeAllForUser(userId, 'password_change');
  }

  /**
   * Issue a password-reset token for a parent, storing only its sha256 with a short expiry.
   * Returns the raw token + recipient for the caller to email, or null when there is no active
   * parent for that email - the caller returns the same generic response either way so the
   * endpoint never reveals whether an account exists.
   */
  async createPasswordResetToken(
    email: string,
  ): Promise<{ user: { id: string; email: string; firstName: string; familyId: string | null }; token: string } | null> {
    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase(), role: 'parent', isActive: true, deletedAt: null },
      select: { id: true, email: true, firstName: true, familyId: true },
    });
    if (!user?.email) return null;

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });

    return { user: { ...user, email: user.email }, token };
  }

  /**
   * Complete a password reset: validate the token, set the new password, clear the reset fields
   * and any lockout, and revoke every existing session. Deliberately does not auto-login - the
   * user proves the new password by signing in with it.
   */
  async resetPassword(token: string, newPassword: string, ctx: { ip?: string } = {}): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await prisma.user.findFirst({
      where: { passwordResetTokenHash: tokenHash, deletedAt: null },
      select: { id: true, role: true, familyId: true, passwordResetExpiresAt: true },
    });

    // One message for every failure (unknown / expired / non-parent) so nothing is leaked.
    if (
      !user ||
      user.role !== 'parent' ||
      !user.passwordResetExpiresAt ||
      user.passwordResetExpiresAt < new Date()
    ) {
      throw new UnauthorizedError('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        ...CLEAR_LOCKOUT,
      },
    });

    await SessionService.revokeAllForUser(user.id, 'password_change');
    await AuditService.logAction({
      actorId: user.id,
      action: 'PASSWORD_RESET',
      resourceType: 'user',
      resourceId: user.id,
      familyId: user.familyId,
      ipAddress: ctx.ip,
    });
  }

  // Refresh access token
  async refreshToken(refreshToken: string, ctx: SessionContext = {}) {
    try {
      const payload = jwt.verify(refreshToken, config.jwt.refreshSecret, jwtVerifyOptions) as TokenPayload & { type: string };

      if (payload.type !== 'refresh') {
        throw new UnauthorizedError('Invalid refresh token');
      }

      // Get user to check if still valid
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        include: { childProfile: true },
      });

      if (!user || !user.isActive || user.deletedAt) {
        throw new UnauthorizedError('User no longer active');
      }

      // Use child-specific expiry for child tokens, standard for parents
      const newTokens = user.role === 'child'
        ? this.generateChildTokens({
            userId: user.id,
            familyId: user.familyId!,
            role: user.role,
            ageGroup: user.childProfile?.ageGroup || undefined,
          })
        : this.generateTokens(
            {
              userId: user.id,
              familyId: user.familyId!,
              role: user.role,
              ageGroup: user.childProfile?.ageGroup || undefined,
            },
            { isMobile: ctx.isMobile }
          );

      // Rotate the server-side session: revoke the presented token and register the new one.
      // Throws 401 on reuse of a spent token (killing the whole chain), on absolute expiry, or
      // when no session matches - the last case being every token minted before this deployed,
      // which is the intended one-time forced re-login.
      await SessionService.rotate(refreshToken, newTokens.refreshToken);

      return newTokens;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Refresh token expired');
      }
      throw error;
    }
  }

  // Get current user
  async getCurrentUser(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        family: true,
        childProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Remove sensitive data. mfaSecret is the (encrypted) TOTP secret — never send it to the
    // client; only mfaEnabledAt is kept, so the UI can show whether 2FA is on (FR-17).
    const { passwordHash: _, mfaSecret: _mfa, ...userWithoutPassword } = user;
    let profile: Record<string, unknown> | undefined;
    if (user.childProfile) {
      const { pinHash: _pin, ...safeProfile } = user.childProfile;
      profile = safeProfile;
    }

    return {
      ...userWithoutPassword,
      childProfile: profile,
    };
  }

  // Generate JWT tokens for parents (standard expiry from config).
  // NOTE: Visibility changed from private → public so InviteService.acceptInvite()
  // can generate tokens for the newly created co-parent without coupling the two
  // services via inheritance. The method does not expose any secrets directly.
  generateTokens(
    payload: Omit<TokenPayload, 'iat' | 'exp'>,
    opts: { isMobile?: boolean } = {}
  ) {
    // Both tokens share one jti, which is also the RefreshSession row id - it links an access
    // token (and any audit row) back to the exact session that issued it.
    const jti = crypto.randomUUID();

    const accessToken = jwt.sign(payload, config.jwt.secret, {
      ...jwtSignOptions,
      expiresIn: config.jwt.expiresIn as any,
      jwtid: jti,
    });

    // P0-4: only the refresh token stretches on mobile. The access token stays short-lived on
    // every client — it is the window in which a revoked session keeps working, and lengthening
    // it would blunt the parent revoke control this change is paired with.
    const refreshExpiry = (opts.isMobile
      ? config.jwt.mobileRefreshExpiresIn
      : config.jwt.refreshExpiresIn) as any;

    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh' },
      config.jwt.refreshSecret,
      { ...jwtSignOptions, expiresIn: refreshExpiry, jwtid: jti }
    );

    const decoded = jwt.decode(accessToken) as { exp: number };
    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

    return { accessToken, refreshToken, expiresIn };
  }

  // Generate JWT tokens for children (extended expiry: 24h access, 90d refresh)
  private generateChildTokens(payload: Omit<TokenPayload, 'iat' | 'exp'>) {
    const childAccessExpiry = (process.env.JWT_CHILD_ACCESS_EXPIRES_IN || '24h') as any;
    const childRefreshExpiry = (process.env.JWT_CHILD_REFRESH_EXPIRES_IN || '90d') as any;

    const jti = crypto.randomUUID();

    const accessToken = jwt.sign(payload, config.jwt.secret, {
      ...jwtSignOptions,
      expiresIn: childAccessExpiry,
      jwtid: jti,
    });

    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh' },
      config.jwt.refreshSecret,
      { ...jwtSignOptions, expiresIn: childRefreshExpiry, jwtid: jti }
    );

    const decoded = jwt.decode(accessToken) as { exp: number };
    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

    return { accessToken, refreshToken, expiresIn };
  }
  // M8 - Create an admin account. Called from POST /auth/admin/register after
  // the ADMIN_INVITE_CODE gate has been validated in the route handler.
  // Admin users have no familyId - they operate across all families and are
  // skipped by the familyIsolation middleware.
  async registerAdmin(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }): Promise<{ user: { id: string; email: string; firstName: string; lastName: string; role: string; familyId: null } }> {
    const { email, password, firstName, lastName } = data;

    // Reject if the email is already registered (any role)
    const existing = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });

    if (existing) {
      throw new ConflictError('An account with this email already exists.');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // familyId is nullable after the M8 migration - admin users have no family.
    // The familyIsolation middleware skips users whose role is 'admin'.
    const user = await prisma.user.create({
      data: {
        email:           email.toLowerCase().trim(),
        passwordHash,
        firstName:       firstName.trim(),
        lastName:        lastName.trim(),
        role:            'admin',
        isActive:        true,
        isPrimaryParent: false,
        // familyId intentionally omitted - nullable in schema after M8 migration
      },
      select: {
        id:        true,
        email:     true,
        firstName: true,
        lastName:  true,
        role:      true,
      },
    });

    // Return with explicit familyId: null so callers (audit log, etc.)
    // have a typed value - admin users genuinely have no family.
    return {
      user: {
        id: user.id,
        email: user.email!,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        familyId: null,
      },
    };
  }

}


export const authService = new AuthService();