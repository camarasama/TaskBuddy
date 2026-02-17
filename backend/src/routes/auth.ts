import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth';
import { inviteService } from '../services/invite';
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { VALIDATION } from '@taskbuddy/shared';

export const authRouter = Router();

// Validation schemas
const registerSchema = z.object({
  familyName: z.string().min(2).max(100),
  parent: z.object({
    firstName: z.string().min(1).max(50),
    lastName: z.string().min(1).max(50),
    email: z.string().email(),
    password: z.string().min(VALIDATION.PASSWORD.MIN_LENGTH),
  }),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Child login now accepts a memorable familyCode string (ADJECTIVE-ANIMAL-NNNN)
// instead of a raw UUID. The string is validated loosely here;
// the service layer resolves and validates it against the DB.
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

// M4: Schema for accepting a co-parent invite
const acceptInviteSchema = z.object({
  token: z.string().min(1),
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  password: z.string().min(VALIDATION.PASSWORD.MIN_LENGTH),
  dateOfBirth: z.string().optional(),
  phone: z.string().optional(),
});

// Helper: determine cookie settings based on environment.
// Cross-origin requests (ngrok, staging) require sameSite:'none' + secure:true.
// Localhost dev can use sameSite:'lax' without secure.
function getCookieOptions(isChild = false) {
  const isProduction = process.env.NODE_ENV === 'production';
  const isCrossOrigin = process.env.CROSS_ORIGIN_COOKIES === 'true' || isProduction;

  // Child refresh cookies live for 90 days; parent cookies 7 days
  const maxAge = isChild
    ? 90 * 24 * 60 * 60 * 1000   // 90 days
    : 7 * 24 * 60 * 60 * 1000;   // 7 days

  return {
    httpOnly: true,
    secure: isCrossOrigin,
    sameSite: (isCrossOrigin ? 'none' : 'lax') as 'none' | 'lax',
    maxAge,
  };
}

// POST /auth/register - Register new family
authRouter.post('/register', validateBody(registerSchema), async (req, res, next) => {
  try {
    const result = await authService.register(req.body);

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

    // Child gets a 90-day refresh cookie
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

    res.json({
      success: true,
      data: { familyCode: newCode },
    });
  } catch (error) {
    next(error);
  }
});

// POST /auth/accept-invite - Co-parent accepts an invitation link (M4)
// Public endpoint — the invitee is not yet authenticated.
authRouter.post('/accept-invite', validateBody(acceptInviteSchema), async (req, res, next) => {
  try {
    const result = await inviteService.acceptInvite(req.body);

    // Log the new co-parent in immediately by setting the refresh cookie
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
    // Try to get refresh token from cookie first, then body
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    const tokens = await authService.refreshToken(refreshToken);

    // Preserve correct cookie lifetime on refresh based on role
    // We peek at the decoded payload to determine if this is a child token
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

    res.json({
      success: true,
      data: { message: 'Password changed successfully' },
    });
  } catch (error) {
    next(error);
  }
});

// GET /auth/me - Get current user
authRouter.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await authService.getCurrentUser(req.user!.userId);

    res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
});