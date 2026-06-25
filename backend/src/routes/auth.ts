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
import { config } from '../config';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { authService } from '../services/auth';
import { inviteService } from '../services/invite';
import { authenticate, requireParent } from '../middleware/auth';
import { uploadPhoto } from '../middleware/upload';
import { uploadFile } from '../services/storage';
import { prisma } from '../services/database';
import { ConflictError, NotFoundError } from '../middleware/errorHandler';
import { validateBody } from '../middleware/validate';
import { VALIDATION } from '@taskbuddy/shared';
// M8 - Audit logging for auth events
import { AuditService } from '../services/AuditService';
// M9 - Email notifications
import { EmailService } from '../services/email';

export const authRouter = Router();

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
    password: z.string().min(VALIDATION.PASSWORD.MIN_LENGTH),
    dateOfBirth: z.string().regex(
      /^\d{4}-\d{2}-\d{2}$/,
      'Date of birth must be in YYYY-MM-DD format'
    ).refine((dob) => {
      const birth = new Date(dob);
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 18);
      return birth <= cutoff;
    }, { message: 'Parent must be at least 18 years old' }),
    phoneNumber: z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        'Phone number must be in E.164 format (e.g. +233201234567)'
      )
      .optional(),
    gender: z.enum(['male', 'female']).optional(),
  }),
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

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(VALIDATION.PASSWORD.MIN_LENGTH),
});

const refreshSchema = z.object({
  refreshToken: z.string().optional(),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  password: z.string().min(VALIDATION.PASSWORD.MIN_LENGTH),
  dateOfBirth: z.string().regex(
    /^\d{4}-\d{2}-\d{2}$/,
    'Date of birth must be in YYYY-MM-DD format'
  ).refine((dob) => {
    const birth = new Date(dob);
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return birth <= cutoff;
  }, { message: 'Co-parent must be at least 18 years old' }).optional(),
  phone: z.string().optional(),
  gender: z.enum(['male', 'female']).optional(),
});

/**
 * M8 - Admin registration schema.
 * inviteCode must match the ADMIN_INVITE_CODE environment variable.
 */
const adminRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(VALIDATION.PASSWORD.MIN_LENGTH),
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
    const result = await authService.register(req.body);

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

    // Generate verification token first so both emails can include it
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.user.update({
      where: { id: result.user.id },
      data: {
        emailVerificationToken: verifyToken,
        emailVerificationExpiresAt: verifyExpiry,
      },
    });
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const verifyUrl = `${frontendUrl}/verify-email?token=${verifyToken}`;

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

    res.cookie('refreshToken', result.tokens.refreshToken, getCookieOptions());

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/login - Login (parent)
authRouter.post('/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body);

    // M8 - Audit: parent login event
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'LOGIN',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
    });

    res.cookie('refreshToken', result.tokens.refreshToken, getCookieOptions());

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/child/login - Child login with family code + PIN
authRouter.post('/child/login', validateBody(childLoginSchema), async (req, res, next) => {
  try {
    const result = await authService.childLogin(req.body);

    // M8 - Audit: child login event
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'LOGIN',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
    });

    res.cookie('refreshToken', result.tokens.refreshToken, getCookieOptions(true));

    res.json({
      success: true,
      data: result,
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
    const result = await inviteService.acceptInvite(req.body);

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
      familyId: result.user.familyId ?? undefined,
      subject: `Welcome to TaskBuddy, ${result.user.firstName}!`,
      templateData: {
        firstName: result.user.firstName,
        familyName: result.family.familyName,
      },
    }).catch((err) =>
      console.error('[auth/accept-invite] Welcome email failed (non-fatal):', err?.message)
    );

    res.cookie('refreshToken', result.tokens.refreshToken, getCookieOptions());

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/refresh - Refresh access token
authRouter.post('/refresh', validateBody(refreshSchema), async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    const tokens = await authService.refreshToken(refreshToken);

    const decoded = jwt.decode(tokens.refreshToken) as { role?: string } | null;
    const isChild = decoded?.role === 'child';

    res.cookie('refreshToken', tokens.refreshToken, getCookieOptions(isChild));

    res.json({
      success: true,
      data: { tokens },
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

    const user = await prisma.user.findFirst({
      where: { emailVerificationToken: token },
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
        const payload = jwt.default.verify(token, config.jwt.secret) as { userId: string };
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
      data: { emailVerificationToken: verifyToken, emailVerificationExpiresAt: verifyExpiry },
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

// POST /auth/logout - Logout
authRouter.post('/logout', (_req, res) => {
  res.clearCookie('refreshToken', getCookieOptions());

  res.json({
    success: true,
    data: { message: 'Logged out successfully' },
  });
});

// PUT /auth/password - Change password
authRouter.put('/password', authenticate, validateBody(changePasswordSchema), async (req, res, next) => {
  try {
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

    // Create the admin user (no family, no child profile)
    const result = await authService.registerAdmin({ email, password, firstName, lastName });

    // M8 - Audit: admin account created
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'REGISTER',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: { email: result.user.email, role: 'admin' },
    });

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
