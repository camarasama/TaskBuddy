/**
 * routes/auth.ts — Updated M8 (Admin System)
 *
 * Changes from M7:
 *  - POST /auth/admin/register: new public endpoint for creating admin accounts.
 *    Requires ADMIN_INVITE_CODE env var to be present and matched. Admin users
 *    have role="admin" and no familyId — they can access all families.
 *  - All mutating routes now call AuditService.logAction() so the audit log
 *    captures auth-level events (register, login, password change).
 *
 * All other routes are unchanged from M7.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth';
import { inviteService } from '../services/invite';
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { VALIDATION } from '@taskbuddy/shared';
// M8 — Audit logging for auth events
import { AuditService } from '../services/AuditService';

export const authRouter = Router();

// ============================================
// VALIDATION SCHEMAS
// ============================================

/**
 * M7 — CR-02: registerSchema includes dateOfBirth (required) and
 * phoneNumber (optional E.164). Unchanged from M7.
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
    ),
    phoneNumber: z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        'Phone number must be in E.164 format (e.g. +233201234567)'
      )
      .optional(),
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
  dateOfBirth: z.string().optional(),
  phone: z.string().optional(),
});

/**
 * M8 — Admin registration schema.
 * inviteCode must match the ADMIN_INVITE_CODE environment variable.
 * This is the only gate — keep the env var secret and share it only
 * with people who should have admin access.
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
 * M7 — CR-02: Masks a phone number to show only the last 4 digits.
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

    // M8 — Audit: capture family + parent creation
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'REGISTER',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
      metadata: { email: result.user.email, familyName: req.body.familyName },
    });

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

    // M8 — Audit: parent login event
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

    // M8 — Audit: child login event
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

    // M8 — Audit: PIN setup by parent
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'child',
      resourceId: req.body.childId,
      familyId: req.user!.familyId,
      ipAddress: req.ip,
      metadata: { event: 'pin_setup' },
    });

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

    // M8 — Audit: family code regenerated
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
// Public endpoint — used by the /invite/accept page before the form is rendered.
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

    // M8 — Audit: co-parent joined family
    await AuditService.logAction({
      actorId: result.user.id,
      action: 'INVITE_ACCEPTED',
      resourceType: 'user',
      resourceId: result.user.id,
      familyId: result.user.familyId,
      ipAddress: req.ip,
      metadata: { email: result.user.email },
    });

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

    const jwt = require('jsonwebtoken');
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

    // M8 — Audit: password changed
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
// M7 — CR-02: Returns dateOfBirth and phoneNumber masked to last 4 digits.
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

// ============================================
// M8 — ADMIN REGISTRATION
// ============================================

/**
 * POST /auth/admin/register
 *
 * Creates a new admin account. The gate is the ADMIN_INVITE_CODE env var —
 * there is no other authentication required. Keep this code strictly secret.
 *
 * Admin accounts have:
 *  - role = "admin"
 *  - familyId = null  (can query all families — no family isolation applies)
 *
 * After creation, the admin must POST /auth/login separately to get a session.
 * We intentionally do NOT auto-login here so the invite code never yields
 * a live access token in the same response.
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

    // Gate 2: submitted code must match
    if (inviteCode !== validCode) {
      return res.status(403).json({
        success: false,
        error: { message: 'Invalid invite code.' },
      });
    }

    // Create the admin user (no family, no child profile)
    const result = await authService.registerAdmin({ email, password, firstName, lastName });

    // M8 — Audit: admin account created
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