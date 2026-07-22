import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from './database';
import { config } from '../config';
import { SessionService, type SessionContext } from './SessionService';
import { AuditService } from './AuditService';
import { jwtVerifyOptions, jwtSignOptions } from '../utils/jwt';
import {
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  ValidationError,
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

type LockoutState = { id: string; failedLoginAttempts: number; lastFailedLoginAt: Date | null };

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
  username?: string;
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

    // Create family and parent user in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create family with memorable code
      const family = await tx.family.create({
        data: {
          familyName,
          familyCode,
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
    const tokens = this.generateTokens({
      userId: result.user.id,
      familyId: result.family.id,
      role: result.user.role,
    });
    await SessionService.create(result.user.id, tokens.refreshToken, { ...ctx, isChild: false });

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

    // Generate tokens (parent uses standard expiry)
    const tokens = this.generateTokens({
      userId: user.id,
      familyId: user.familyId!,
      role: user.role,
      ageGroup: user.childProfile?.ageGroup || undefined,
    });
    await SessionService.create(user.id, tokens.refreshToken, { ...ctx, isChild: false });

    // Remove sensitive data
    const { passwordHash: _, ...userWithoutPassword } = user;

    return {
      user: userWithoutPassword,
      profile: user.childProfile,
      tokens,
    };
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
    const user = family
      ? await prisma.user.findFirst({
          where: {
            familyId: family.id,
            role: 'child',
            deletedAt: null,
            OR: [
              { firstName: { equals: childIdentifier, mode: 'insensitive' } },
              { username: { equals: childIdentifier, mode: 'insensitive' } },
            ],
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
    await SessionService.create(user.id, tokens.refreshToken, { ...ctx, isChild: true });

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

    // Check if username is taken (if provided)
    if (username) {
      const existingUsername = await prisma.user.findFirst({
        where: { username: { equals: username, mode: 'insensitive' } },
      });
      if (existingUsername) {
        throw new ConflictError('Username already taken');
      }
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
          username: username?.toLowerCase(),
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
  async refreshToken(refreshToken: string, _ctx: SessionContext = {}) {
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
        : this.generateTokens({
            userId: user.id,
            familyId: user.familyId!,
            role: user.role,
            ageGroup: user.childProfile?.ageGroup || undefined,
          });

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

    // Remove sensitive data
    const { passwordHash: _, ...userWithoutPassword } = user;
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
  generateTokens(payload: Omit<TokenPayload, 'iat' | 'exp'>) {
    // Both tokens share one jti, which is also the RefreshSession row id - it links an access
    // token (and any audit row) back to the exact session that issued it.
    const jti = crypto.randomUUID();

    const accessToken = jwt.sign(payload, config.jwt.secret, {
      ...jwtSignOptions,
      expiresIn: config.jwt.expiresIn as any,
      jwtid: jti,
    });

    const refreshToken = jwt.sign(
      { ...payload, type: 'refresh' },
      config.jwt.refreshSecret,
      { ...jwtSignOptions, expiresIn: config.jwt.refreshExpiresIn as any, jwtid: jti }
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