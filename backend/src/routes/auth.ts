/**
 * routes/auth.ts - Updated M9 (Email Notifications)
 *
 * Changes from M8:
 *  - POST /auth/register: calls EmailService.send('welcome', ...) after successful
 *    family + parent creation. Fire-and-forget - email failure never blocks registration.
 *  - POST /auth/accept-invite: calls EmailService.send('co_parent_invite_accepted', ...)
 *    to notify all existing family parents that a new co-parent has joined.
 *    The actual co-parent invite email is sent by InviteService (invite.ts), not here.
 *
 * All other routes are unchanged from M8.
 */

import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { config } from '../config';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authService } from '../services/auth';
import { inviteService } from '../services/invite';
import { SessionService } from '../services/SessionService';
import { jwtVerifyOptions, signMfaToken, verifyMfaToken } from '../utils/jwt';
import { hashToken } from '../utils/tokens';
import { getClient, isMobileClient, isMobilePlatform } from '../utils/client';
import { authenticate, requireParent } from '../middleware/auth';
import { requireCsrf, issueCsrfCookie, clearCsrfCookie } from '../middleware/csrf';
import { uploadPhoto } from '../middleware/upload';
import { uploadFile } from '../services/storage';
import { prisma } from '../services/database';
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../middleware/errorHandler';
import { isPasswordBreached } from '../utils/passwordBreach';
import { pruneExpired } from '../utils/rateLimitSweep';
import { validateBody } from '../middleware/validate';
import { VALIDATION, CONSENT_VERSIONS, AGE_LIMITS, isAgeBetween } from '@taskbuddy/shared';
// M8 - Audit logging for auth events
import { AuditService } from '../services/AuditService';
// M9 - Email notifications
import { EmailService } from '../services/email';
import { AnalyticsService } from '../services/AnalyticsService';

export const authRouter = Router();

/**
 * The refresh token is delivered to browsers ONLY as an HttpOnly cookie (set via res.cookie
 * alongside each of these responses). Strip it from the JSON body so it never reaches
 * JS-readable storage, where XSS could exfiltrate a long-lived credential (F-2).
 */
function withoutRefreshToken<T extends { refreshToken?: string }>(tokens: T): Omit<T, 'refreshToken'> {
  const safe = { ...tokens };
  delete (safe as { refreshToken?: string }).refreshToken;
  return safe;
}

/**
 * P0-1 — deliver the refresh token by the only mechanism the caller can actually use, and return
 * the token object that belongs in the JSON body.
 *
 * Browsers get an HttpOnly cookie and never see the token in the body (F-2, above). Native clients
 * have no cookie jar: React Native's fetch does not persist `SameSite=None; Secure` cookies
 * reliably, so a mobile session would not survive an app restart. They get the token in the body
 * and put it straight into the OS keystore (expo-secure-store), which is the platform equivalent
 * of the protection HttpOnly buys on the web — not a weakening of it.
 *
 * The trade is favourable in the other direction too: a body-supplied credential is explicit
 * rather than ambient, so it carries no CSRF exposure, which is why middleware/csrf.ts already
 * exempts that path.
 *
 * Web behaviour must stay byte-identical. `isMobileClient` is false for every request without a
 * well-formed `X-Client` header naming a native platform, and auth-refresh-token-body.test.ts
 * asserts the browser path still strips the token.
 */
function deliverTokens<T extends { refreshToken?: string }>(
  req: Request,
  res: Response,
  tokens: T,
  isChild = false
): T | Omit<T, 'refreshToken'> {
  if (isMobileClient(req)) return tokens;

  res.cookie('refreshToken', tokens.refreshToken, getCookieOptions(isChild));
  issueCsrfCookie(res);
  return withoutRefreshToken(tokens);
}

// ============================================
// VALIDATION SCHEMAS
// ============================================

/**
 * M7 - CR-02: registerSchema includes dateOfBirth (required) and
 * phoneNumber (optional E.164). Unchanged from M7/M8.
 */
const registerSchema = z.object({
  familyName: z.string().min(2).max(100),
  parent: z.object({
    firstName: z.string().min(1).max(50),
    lastName: z.string().min(1).max(50),
    email: z.string().email(),
    password: z.string().min(VALIDATION.PASSWORD.NEW_MIN_LENGTH),
    dateOfBirth: z.string().regex(
      /^\d{4}-\d{2}-\d{2}$/,
      'Date of birth must be in YYYY-MM-DD format'
    ).refine((dob) => isAgeBetween(dob, AGE_LIMITS.ADULT_MIN, null), {
      message: `Parent must be at least ${AGE_LIMITS.ADULT_MIN} years old`,
    }),
    phoneNumber: z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        'Phone number must be in E.164 format (e.g. +233201234567)'
      )
      .optional(),
    gender: z.enum(['male', 'female']).optional(),
  }),
  // U20 — optional cross-family referral. An unknown code is IGNORED rather than rejected: the
  // whole point of this feature is to produce signups, and failing one over a mistyped code would
  // defeat it. Length-bounded only; validity is resolved in the service.
  referralCode: z.string().max(32).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const childLoginSchema = z.object({
  familyCode: z.string().min(1).max(50).transform((val) => val.toUpperCase().trim()),
  childIdentifier: z.string().min(1),
  pin: z.string().regex(VALIDATION.PIN.PATTERN, 'PIN must be exactly 4 digits'),
  deviceId: z.string().optional(),
});

const setupPinSchema = z.object({
  childId: z.string().uuid(),
  pin: z.string().regex(VALIDATION.PIN.PATTERN, 'PIN must be exactly 4 digits'),
});

// Deliberately the SAME shape as childLoginSchema minus `pin` and `deviceId` — this is the
// unauthenticated "I forgot my PIN" counterpart to child login, so it takes exactly what child
// login takes to identify the child, and nothing that could identify the requester as anything
// more privileged than "knows the family code and a child's username".
const childPinResetRequestSchema = z.object({
  familyCode: z.string().min(1).max(50).transform((val) => val.toUpperCase().trim()),
  childIdentifier: z.string().min(1),
});

const childPinResetCompleteSchema = z.object({
  token: z.string().min(1),
  newPin: z.string().regex(VALIDATION.PIN.PATTERN, 'PIN must be exactly 4 digits'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(VALIDATION.PASSWORD.NEW_MIN_LENGTH),
});

const refreshSchema = z.object({
  refreshToken: z.string().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(VALIDATION.PASSWORD.NEW_MIN_LENGTH),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  password: z.string().min(VALIDATION.PASSWORD.NEW_MIN_LENGTH),
  dateOfBirth: z.string().regex(
    /^\d{4}-\d{2}-\d{2}$/,
    'Date of birth must be in YYYY-MM-DD format'
  ).refine((dob) => isAgeBetween(dob, AGE_LIMITS.ADULT_MIN, null), {
    message: `Co-parent must be at least ${AGE_LIMITS.ADULT_MIN} years old`,
  }).optional(),
  phone: z.string().optional(),
  gender: z.enum(['male', 'female']).optional(),
});

/**
 * M8 - Admin registration schema.
 * inviteCode must match the ADMIN_INVITE_CODE environment variable.
 */
const adminRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(VALIDATION.PASSWORD.NEW_MIN_LENGTH),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  inviteCode: z.string().min(1),
});

// ============================================
// HELPER FUNCTIONS
// ============================================

function getCookieOptions(isChild = false) {
  const isProduction = process.env.NODE_ENV === 'production';
  const isCrossOrigin = process.env.CROSS_ORIGIN_COOKIES === 'true' || isProduction;

  const maxAge = isChild
    ? 90 * 24 * 60 * 60 * 1000  // 90 days for children
    : 7 * 24 * 60 * 60 * 1000;  // 7 days for parents / admins

  return {
    httpOnly: true,
    secure: isCrossOrigin,
    sameSite: (isCrossOrigin ? 'none' : 'lax') as 'none' | 'lax',
    maxAge,
  };
}

/**
 * M7 - CR-02: Masks a phone number to show only the last 4 digits.
 * e.g. "+233201234567" → "••••••••4567"
 */
/**
 * P0-4 — the request context carried into every session the auth service opens.
 *
 * The stored `client` is rebuilt from the *parsed* header rather than passed through raw, and only
 * for a recognised native platform. That matters because this string is rendered back to a parent
 * in the signed-in-devices list: an attacker who could put arbitrary text in `X-Client` would be
 * writing into someone else's UI. `parseClientHeader` bounds it to `<platform>/<semver>`.
 */
function sessionContext(req: Request) {
  const client = getClient(req);
  const mobile = client !== null && isMobilePlatform(client.platform);

  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    isMobile: mobile,
    client: mobile ? `${client!.platform}/${client!.version}` : undefined,
  };
}

function maskPhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  if (phone.length <= 4) return phone;
  const lastFour = phone.slice(-4);
  const maskedPart = '•'.repeat(phone.length - 4);
  return `${maskedPart}${lastFour}`;
}

// ============================================
// ROUTES
// ============================================

// POST /auth/register - Register new family
authRouter.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    // F-10: reject passwords known to be breached (k-anonymity check, fail-open).
    if (await isPasswordBreached(req.body.parent.password)) {
      throw new ValidationError('This password has appeared in a known data breach. Please choose a different one.');
    }

    const result = await authService.register(req.body, {
      ...sessionContext(req),
    });

    // M8 - Audit: capture family + parent creation
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'REGISTER',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
      metadata: { email: result.user.email, familyName: req.body.familyName },
    });

    // GDPR-K: record the parent's consent to the current ToS + Privacy Policy at registration.
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'CONSENT',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
      metadata: { tosVersion: CONSENT_VERSIONS.tos, privacyVersion: CONSENT_VERSIONS.privacy, context: 'register' },
    });

    // Generate verification token first so both emails can include it
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: result.user.id },
      data: {
        emailVerificationToken: hashToken(verifyToken), // stored hashed; raw token goes in the link
        emailVerificationExpiresAt: verifyExpiry,
      },
    });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyUrl = `${frontendUrl}/verify-email?token=${verifyToken}`;

    // Funnel instrumentation (roadmap 0b) — the clock for "registration → first approved task"
    // starts here. Fire-and-forget; no email or name goes in the payload.
    void AnalyticsService.record({
      eventType: 'SIGNUP',
      familyId: result.user.familyId,
      actorRole: 'parent',
      payload: { userId: result.user.id },
    });

    // Welcome email - CTA links directly to the verification URL
    EmailService.send({
      triggerType: 'welcome',
      toEmail: result.user.email!,
      toUserId: result.user.id,
      familyId: result.user.familyId!,
      subject: `Welcome to TaskBuddy, ${result.user.firstName}!`,
      templateData: {
        firstName: result.user.firstName,
        familyName: req.body.familyName,
        verifyUrl,
      },
    }).catch((err) =>
      console.error('[auth/register] Welcome email failed (non-fatal):', err?.message)
    );

    // Dedicated verification email
    EmailService.send({
      triggerType: 'email_verification',
      toEmail: result.user.email!,
      toUserId: result.user.id,
      familyId: result.user.familyId!,
      subject: 'Verify your TaskBuddy email',
      templateData: { firstName: result.user.firstName, verifyUrl, expiryHours: 24 },
    }).catch((err) =>
      console.error('[auth/register] Verification email failed (non-fatal):', err?.message)
    );

    res.status(201).json({
      success: true,
      data: { ...result, tokens: deliverTokens(req, res, result.tokens) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/login - Login (parent)
authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body, {
      ...sessionContext(req),
    });

    // F-9: MFA-enrolled admin — password was correct but no session is issued yet. Hand back a
    // short-lived challenge token; the client finishes at POST /auth/mfa/challenge with a TOTP code.
    if ('mfaRequired' in result) {
      const mfaToken = signMfaToken(result.user.id, config.jwt.secret);
      return res.json({ success: true, data: { mfaRequired: true, mfaToken } });
    }

    // M8 - Audit: parent login event
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'LOGIN',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: { ...result, tokens: deliverTokens(req, res, result.tokens) },
    });
  } catch (error) {
    next(error);
  }
});

// ─── MFA (F-9 admins; FR-17 extends enrolment to parents) ────────────────────
// Gated with requireParent, which is requireRole('parent','admin') — so parents and admins may
// enrol; children (PIN auth) cannot. Admin-mandatory enforcement lives in the service layer.

const mfaCodeSchema = z.object({ code: z.string().min(6).max(10) });
const mfaChallengeSchema = z.object({
  mfaToken: z.string().min(10),
  code: z.string().min(6).max(10),
});

// POST /auth/mfa/setup - begin enrollment; returns an otpauth:// URL for the authenticator app.
authRouter.post('/mfa/setup', authenticate, requireParent, async (req, res, next) => {
  try {
    const { otpauthUrl } = await authService.setupMfa(req.user!.userId);
    res.json({ success: true, data: { otpauthUrl } });
  } catch (error) {
    next(error);
  }
});

// POST /auth/mfa/enable - confirm enrollment with the first code; enables MFA on the account.
authRouter.post('/mfa/enable', authenticate, requireParent, validateBody(mfaCodeSchema), async (req, res, next) => {
  try {
    await authService.confirmMfa(req.user!.userId, req.body.code);
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'MFA_ENABLED',
      resourceType: 'user',
      resourceId: req.user!.userId,
      familyId: req.user!.familyId ?? null,
      ipAddress: req.ip,
    });
    res.json({ success: true, data: { message: 'MFA enabled.' } });
  } catch (error) {
    next(error);
  }
});

// POST /auth/mfa/disable - turn MFA off; requires a valid current TOTP code (FR-17).
authRouter.post('/mfa/disable', authenticate, requireParent, validateBody(mfaCodeSchema), async (req, res, next) => {
  try {
    await authService.disableMfa(req.user!.userId, req.body.code);
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'MFA_DISABLED',
      resourceType: 'user',
      resourceId: req.user!.userId,
      familyId: req.user!.familyId ?? null,
      ipAddress: req.ip,
    });
    res.json({ success: true, data: { message: 'MFA disabled.' } });
  } catch (error) {
    next(error);
  }
});

// POST /auth/mfa/challenge - finish an MFA login: exchange the challenge token + TOTP code for a session.
authRouter.post('/mfa/challenge', validateBody(mfaChallengeSchema), async (req, res, next) => {
  try {
    let userId: string;
    try {
      ({ userId } = verifyMfaToken(req.body.mfaToken, config.jwt.secret));
    } catch {
      throw new UnauthorizedError('MFA session expired. Please log in again.');
    }
    const result = await authService.verifyMfaAndLogin(userId, req.body.code, {
      ...sessionContext(req),
    });
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'LOGIN',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
      metadata: { mfa: true },
    });
    res.json({
      success: true,
      data: { ...result, tokens: deliverTokens(req, res, result.tokens) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/child/login - Child login with family code + PIN
authRouter.post('/child/login', validateBody(childLoginSchema), async (req, res, next) => {
  try {
    const result = await authService.childLogin(req.body, {
      ...sessionContext(req),
    });

    // M8 - Audit: child login event
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'LOGIN',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      data: { ...result, tokens: deliverTokens(req, res, result.tokens, true) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/child/pin/setup - Set up PIN for child
authRouter.post('/child/pin/setup', authenticate, validateBody(setupPinSchema), async (req, res, next) => {
  try {
    await authService.setupPin(req.body.childId, req.body.pin, req.user!.userId);

    // M8 - Audit: PIN setup by parent
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'child',
      resourceId: req.body.childId,
      familyId: req.user!.familyId,
      ipAddress: req.ip,
      metadata: { event: 'pin_setup' },
    });

    // M9 - fire-and-forget PIN reset notification email
    prisma.user.findUnique({
      where: { id: req.body.childId },
      select: { id: true, email: true, firstName: true, familyId: true },
    }).then((childUser) => {
      if (childUser?.email) {
        EmailService.send({
          triggerType: 'child_profile_updated',
          toEmail: childUser.email,
          toUserId: childUser.id,
          familyId: childUser.familyId!,
          subject: `Your TaskBuddy PIN was reset`,
          templateData: {
            childFirstName: childUser.firstName,
            changed: 'PIN',
            appUrl: process.env.CLIENT_URL || 'http://localhost:3000',
          },
          skipPreferenceCheck: true,
        }).catch((err: Error) => console.error('[child_pin_updated email]', err.message));
      }
    }).catch((err: Error) => console.error('[child_pin_updated email] user fetch failed', err.message));

    res.json({
      success: true,
      data: { message: 'PIN set up successfully' },
    });
  } catch (error) {
    next(error);
  }
});

// ── Child-initiated PIN reset ─────────────────────────────────────────────────
// A child who forgot their PIN cannot authenticate to ask a parent to reset it (that's the
// existing /child/pin/setup route above, gated by `authenticate` + a parent session) — this is the
// unauthenticated counterpart, reached from the sign-in screen. Rate-limited the same way
// /child/login is (see index.ts: authLimiter is mounted on this path too), for the same reason:
// the input here — a family code plus a child's username — is exactly as guessable as a login
// attempt, just without a PIN to also brute-force.

// POST /auth/child/pin-reset/request - Request a PIN-reset email for a child (unauthenticated)
authRouter.post(
  '/child/pin-reset/request',
  validateBody(childPinResetRequestSchema),
  async (req, res, next) => {
    try {
      await authService.requestChildPinReset(req.body.familyCode, req.body.childIdentifier);

      // Identical response whether or not the family/child pair exists — this route must NEVER
      // branch on anything the service could tell it, because the service deliberately returns
      // nothing to branch on (see AuthService.requestChildPinReset for the anti-enumeration
      // reasoning in full). An oracle here enumerates children, not adults.
      res.json({
        success: true,
        data: {
          message: "If that family and child match, a reset link has been sent to the family's parents.",
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /auth/child/pin-reset/complete - Complete a child PIN reset with the emailed token
authRouter.post(
  '/child/pin-reset/complete',
  validateBody(childPinResetCompleteSchema),
  async (req, res, next) => {
    try {
      await authService.completeChildPinReset(req.body.token, req.body.newPin);
      res.json({
        success: true,
        data: { message: 'PIN reset successfully. You can now sign in with your new PIN.' },
      });
    } catch (error) {
      next(error);
    }
  },
);

// POST /auth/family/regenerate-code - Regenerate memorable family code (parent only)
authRouter.post('/family/regenerate-code', authenticate, async (req, res, next) => {
  try {
    const newCode = await authService.regenerateFamilyCode(
      req.user!.familyId,
      req.user!.userId
    );

    // M8 - Audit: family code regenerated
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'family',
      resourceId: req.user!.familyId,
      familyId: req.user!.familyId,
      ipAddress: req.ip,
      metadata: { event: 'family_code_regenerated' },
    });

    res.json({
      success: true,
      data: { familyCode: newCode },
    });
  } catch (error) {
    next(error);
  }
});

// GET /auth/invite-preview?token=... - Fetch family/inviter info before showing the form
// Public endpoint - used by the /invite/accept page before the form is rendered.
authRouter.get('/invite-preview', async (req, res, next) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      return res.status(400).json({
        success: false,
        error: { message: 'Token is required' },
      });
    }

    const preview = await inviteService.getInvitePreview(token);

    res.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/accept-invite - Co-parent accepts an invitation link (M4)
authRouter.post('/accept-invite', validateBody(acceptInviteSchema), async (req, res, next) => {
  try {
    const result = await inviteService.acceptInvite(req.body, {
      ...sessionContext(req),
    });

    // M8 - Audit: co-parent joined family
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'INVITE_ACCEPTED',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
      metadata: { email: result.user.email },
    });

    // M9 - Welcome email for the new co-parent (fire-and-forget)
    EmailService.send({
      triggerType: 'welcome',
      toEmail: result.user.email!,
      toUserId: result.user.id,
      familyId: result.user.familyId!,
      subject: `Welcome to TaskBuddy, ${result.user.firstName}!`,
      templateData: {
        firstName: result.user.firstName,
        familyName: result.family.familyName,
      },
    }).catch((err) =>
      console.error('[auth/accept-invite] Welcome email failed (non-fatal):', err?.message)
    );

    res.status(201).json({
      success: true,
      data: { ...result, tokens: deliverTokens(req, res, result.tokens) },
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/refresh - Refresh access token
// GET /auth/csrf-token - issue (or re-issue) the double-submit CSRF token.
// Public and safe: the token authorises nothing on its own — it is only meaningful when paired
// with the caller's own refresh cookie. Clients call this when they hold a session cookie but no
// csrfToken cookie, e.g. a session that predates this feature shipping.
authRouter.get('/csrf-token', (_req, res) => {
  const csrfToken = issueCsrfCookie(res);
  res.json({ success: true, data: { csrfToken } });
});

authRouter.post('/refresh', requireCsrf, validateBody(refreshSchema), async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    const tokens = await authService.refreshToken(refreshToken, sessionContext(req));

    const decoded = jwt.decode(tokens.refreshToken) as { role?: string } | null;
    const isChild = decoded?.role === 'child';

    res.json({
      success: true,
      data: { tokens: deliverTokens(req, res, tokens, isChild) },
    });
  } catch (error) {
    next(error);
  }
});

// ── Email verification ────────────────────────────────────────────────────────

// POST /auth/verify-email - Consume verification token
authRouter.post('/verify-email', async (req, res, next) => {
  try {
    const { token } = req.body as { token?: string };
    if (!token) throw new NotFoundError('Verification token is required');

    // Hashed lookup only (F-7). The transitional raw-token branch was removed once every
    // pre-hashing token had expired — see the dual-read window note in docs/DEPLOYMENT.md.
    const user = await prisma.user.findFirst({
      where: { emailVerificationToken: hashToken(token) },
      select: { id: true, emailVerificationExpiresAt: true, emailVerifiedAt: true },
    });

    if (!user) throw new NotFoundError('Invalid or expired verification link');
    if (user.emailVerifiedAt) {
      return res.json({ success: true, data: { message: 'Email already verified' } });
    }
    if (!user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
      throw new ConflictError('Verification link has expired. Please request a new one.');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerificationToken: null,
        emailVerificationExpiresAt: null,
      },
    });

    res.json({ success: true, data: { message: 'Email verified successfully' } });
  } catch (error) {
    next(error);
  }
});

// Rate limiter: max 3 resends per hour keyed by email address
const resendRateLimit = new Map<string, { count: number; resetAt: number }>();

// POST /auth/resend-verification - no auth required (works from email link in fresh session)
// Accepts { email } in body OR uses req.user.userId if the user is already logged in.
authRouter.post('/resend-verification', async (req, res, next) => {
  try {
    // Support both authenticated (token present) and unauthenticated (email in body) callers
    let user: { id: string; email: string | null; firstName: string; emailVerifiedAt: Date | null; familyId: string | null } | null = null;

    if (req.headers.authorization) {
      // Try to authenticate silently - ignore errors (token may have expired)
      try {
        const jwt = await import('jsonwebtoken');
        const token = req.headers.authorization.split(' ')[1];
        const payload = jwt.default.verify(token, config.jwt.secret, jwtVerifyOptions) as { userId: string };
        user = await prisma.user.findUnique({
          where: { id: payload.userId },
          select: { id: true, email: true, firstName: true, emailVerifiedAt: true, familyId: true },
        });
      } catch { /* fall through to email-based lookup */ }
    }

    if (!user && req.body?.email) {
      user = await prisma.user.findFirst({
        where: { email: (req.body.email as string).toLowerCase(), deletedAt: null },
        select: { id: true, email: true, firstName: true, emailVerifiedAt: true, familyId: true },
      });
    }

    // Always return 200 to prevent email enumeration
    if (!user?.email) {
      return res.json({ success: true, data: { message: 'If that email exists, a verification link has been sent.' } });
    }
    if (user.emailVerifiedAt) {
      return res.json({ success: true, data: { message: 'Email already verified' } });
    }

    // Rate limit by email
    const rateKey = user.email.toLowerCase();
    const now = Date.now();
    const limit = resendRateLimit.get(rateKey);
    if (limit && now < limit.resetAt) {
      if (limit.count >= 3) throw new ConflictError('Too many requests. Please try again in an hour.');
      limit.count++;
    } else {
      resendRateLimit.set(rateKey, { count: 1, resetAt: now + 60 * 60 * 1000 });
    }

    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerificationToken: hashToken(verifyToken), emailVerificationExpiresAt: verifyExpiry },
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    EmailService.send({
      triggerType: 'email_verification',
      toEmail: user.email,
      toUserId: user.id,
      familyId: user.familyId!,
      subject: 'Verify your TaskBuddy email',
      templateData: {
        firstName: user.firstName,
        verifyUrl: `${frontendUrl}/verify-email?token=${verifyToken}`,
        expiryHours: 24,
      },
    }).catch((err) =>
      console.error('[auth/resend-verification] Email failed (non-fatal):', err?.message)
    );

    res.json({ success: true, data: { message: 'Verification email sent' } });
  } catch (error) {
    next(error);
  }
});

// Rate limiter: max 3 password-reset requests per hour keyed by email address. Checked before
// the account lookup and returning the same generic response on exceed, so it protects a real
// inbox from flooding without ever revealing whether an account exists.
const forgotPasswordRateLimit = new Map<string, { count: number; resetAt: number }>();

function isForgotPasswordRateLimited(email: string): boolean {
  const now = Date.now();
  const limit = forgotPasswordRateLimit.get(email);
  if (limit && now < limit.resetAt) {
    if (limit.count >= 3) return true;
    limit.count++;
    return false;
  }
  forgotPasswordRateLimit.set(email, { count: 1, resetAt: now + 60 * 60 * 1000 });
  return false;
}

// F-10: these anti-enumeration maps only ever grow as new emails hit them. Prune expired entries
// hourly so they cannot leak memory. Unref'd so it never keeps the process alive; skipped under test.
if (config.env !== 'test') {
  setInterval(() => {
    pruneExpired(resendRateLimit);
    pruneExpired(forgotPasswordRateLimit);
  }, 60 * 60 * 1000).unref();
}

// POST /auth/forgot-password - Request a password reset link (parents only)
authRouter.post('/forgot-password', validateBody(forgotPasswordSchema), async (req, res, next) => {
  // Always the same 200 response, whether or not the email maps to an account (anti-enumeration).
  const genericOk = () =>
    res.json({
      success: true,
      data: { message: 'If an account exists for that email, a password reset link has been sent.' },
    });

  try {
    const email = (req.body.email as string).toLowerCase();
    if (isForgotPasswordRateLimited(email)) return genericOk();

    const result = await authService.createPasswordResetToken(email);
    if (!result) return genericOk();

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    EmailService.send({
      triggerType: 'password_reset',
      toEmail: result.user.email,
      toUserId: result.user.id,
      familyId: result.user.familyId!,
      subject: 'Reset your TaskBuddy password',
      templateData: {
        firstName: result.user.firstName,
        resetUrl: `${frontendUrl}/reset-password?token=${result.token}`,
        expiryHours: 1,
      },
      // Security email - never gated by notification preferences.
      skipPreferenceCheck: true,
    }).catch((err) =>
      console.error('[auth/forgot-password] Email failed (non-fatal):', err?.message)
    );

    return genericOk();
  } catch (error) {
    next(error);
  }
});

// POST /auth/reset-password - Complete a password reset with the emailed token
authRouter.post('/reset-password', validateBody(resetPasswordSchema), async (req, res, next) => {
  try {
    if (await isPasswordBreached(req.body.newPassword)) {
      throw new ValidationError('This password has appeared in a known data breach. Please choose a different one.');
    }
    await authService.resetPassword(req.body.token, req.body.newPassword, { ip: req.ip });
    res.json({
      success: true,
      data: { message: 'Password reset successfully. Please log in with your new password.' },
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/logout - Logout
authRouter.post('/logout', requireCsrf, async (req, res) => {
  // Revoke the server-side session so the refresh token is dead even if it was captured. Logout
  // must always succeed, so an unknown/absent token is a no-op rather than an error.
  //
  // P0-1: native clients hold the token in the OS keystore and send it in the body — reading only
  // the cookie would leave their session alive server-side after a "sign out", which is exactly
  // the credential the parent remote-revoke control (P0-4) exists to kill.
  const sessionToken = req.cookies?.refreshToken || req.body?.refreshToken;
  await SessionService.revokeByToken(sessionToken, 'logout').catch((err) =>
    console.error('[auth/logout] session revoke failed (non-fatal):', err?.message)
  );

  res.clearCookie('refreshToken', getCookieOptions());
  clearCsrfCookie(res);

  res.json({
    success: true,
    data: { message: 'Logged out successfully' },
  });
});

// PUT /auth/password - Change password
authRouter.put('/password', authenticate, validateBody(changePasswordSchema), async (req, res, next) => {
  try {
    if (await isPasswordBreached(req.body.newPassword)) {
      throw new ValidationError('This password has appeared in a known data breach. Please choose a different one.');
    }
    await authService.changePassword(req.user!.userId, req.body.currentPassword, req.body.newPassword);

    // M8 - Audit: password changed
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'user',
      resourceId: req.user!.userId,
      familyId: req.user!.familyId,
      ipAddress: req.ip,
      metadata: { event: 'password_changed' },
    });

    res.json({
      success: true,
      data: { message: 'Password changed successfully' },
    });
  } catch (error) {
    next(error);
  }
});

// GET /auth/me - Get current user
// M7 - CR-02: Returns dateOfBirth and phoneNumber masked to last 4 digits.
authRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await authService.getCurrentUser(req.user!.userId);

    const safeUser = {
      ...user,
      phoneNumber: maskPhoneNumber((user as any).phoneNumber),
    };

    res.json({
      success: true,
      data: { user: safeUser },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /auth/me - Update current parent's own profile (avatarUrl etc.)
const updateMeSchema = z.object({
  avatarUrl: z.string().url().nullable().optional(),
  gender: z.enum(['male', 'female']).nullable().optional(),
});

authRouter.put('/me', authenticate, requireParent, validateBody(updateMeSchema), async (req, res, next) => {
  try {
    const updated = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        avatarUrl: req.body.avatarUrl ?? undefined,
        gender: req.body.gender ?? undefined,
      },
    });
    const { passwordHash: _, ...user } = updated;
    res.json({ success: true, data: { user } });
  } catch (error) {
    next(error);
  }
});

// POST /auth/upload-image - Upload an image to storage, return its URL (no DB write)
authRouter.post(
  '/upload-image',
  authenticate,
  uploadPhoto.single('photo'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
      }
      const result = await uploadFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        config.apiUrl,
        { kind: 'avatar' }, // avatars stay public (parent-chosen, low sensitivity)
      );
      res.json({ success: true, data: { url: result.thumbnailUrl } });
    } catch (error) {
      next(error);
    }
  },
);

// ============================================
// M8 - ADMIN REGISTRATION
// ============================================

/**
 * POST /auth/admin/register
 *
 * Creates a new admin account. The gate is the ADMIN_INVITE_CODE env var.
 * After creation, the admin must POST /auth/login separately to get a session.
 *
 * Required env var: ADMIN_INVITE_CODE
 */
authRouter.post('/admin/register', validateBody(adminRegisterSchema), async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, inviteCode } = req.body;

    // Gate 1: env var must be configured
    const validCode = process.env.ADMIN_INVITE_CODE;
    if (!validCode) {
      return res.status(503).json({
        success: false,
        error: { message: 'Admin registration is not enabled on this server.' },
      });
    }

    // Gate 2: submitted code must match - use timing-safe comparison to prevent timing attacks
    const inviteBuffer = Buffer.from(inviteCode);
    const validBuffer  = Buffer.from(validCode);
    const codeMatches =
      inviteBuffer.length === validBuffer.length &&
      crypto.timingSafeEqual(inviteBuffer, validBuffer);
    if (!codeMatches) {
      return res.status(403).json({
        success: false,
        error: { message: 'Invalid invite code.' },
      });
    }

    // Gate 3 (F-9 invite hardening): once ANY admin exists, the static invite code alone is not
    // enough — an existing admin must be signed in to create another. The very first admin is still
    // bootstrapped by the invite code alone.
    const adminCount = await prisma.user.count({ where: { role: 'admin', deletedAt: null } });
    if (adminCount > 0) {
      const bearer = req.headers.authorization?.split(' ')[1];
      let requester: { role?: string } | null = null;
      try {
        requester = bearer ? (jwt.verify(bearer, config.jwt.secret, jwtVerifyOptions) as { role?: string }) : null;
      } catch {
        requester = null;
      }
      if (!requester || requester.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: { message: 'An existing admin must be signed in to create another admin.' },
        });
      }
    }

    // Create the admin user (no family, no child profile)
    const result = await authService.registerAdmin({ email, password, firstName, lastName });

    // M8 - Audit: admin account created
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'ADMIN_CREATED',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: { email: result.user.email, role: 'admin' },
    });

    // F-9: notify every existing admin that a new admin was created (high-privilege event).
    const otherAdmins = await prisma.user.findMany({
      where: { role: 'admin', deletedAt: null, isActive: true, id: { not: result.user.id } },
      select: { email: true, firstName: true },
    });
    await Promise.allSettled(
      otherAdmins
        .filter((a) => a.email)
        .map((a) =>
          EmailService.send({
            triggerType: 'admin_created',
            toEmail: a.email as string,
            toUserId: null,
            familyId: null,
            subject: 'A new TaskBuddy admin account was created',
            templateData: { adminFirstName: a.firstName, newAdminEmail: result.user.email },
            skipPreferenceCheck: true,
          }).catch(() => {}),
        ),
    );

    res.status(201).json({
      success: true,
      data: {
        message: 'Admin account created. Please log in with your credentials.',
        user: {
          id: result.user.id,
          email: result.user.email,
          firstName: result.user.firstName,
          lastName: result.user.lastName,
          role: result.user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});
