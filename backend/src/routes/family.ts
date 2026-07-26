import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { CONSENT_VERSIONS, AVATAR_EMOJIS } from '@taskbuddy/shared';
import { ConsentService } from '../services/ConsentService';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../services/database';
import { authService } from '../services/auth';
import { inviteService } from '../services/invite';
import { authenticate, requireParent, requireChild, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { NotFoundError, ForbiddenError } from '../middleware/errorHandler';
// M5 - import capacity utility
import { getChildCapacity, type ChildCapacity } from '../utils/assignmentLimits';
// M8 - Audit logging for all mutating family routes
import { AuditService } from '../services/AuditService';
// M9 - Email notifications
import { EmailService } from '../services/email';

export const familyRouter = Router();

// All family routes require authentication and family isolation
familyRouter.use(authenticate, familyIsolation);

// Validation schemas
const addChildSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  dateOfBirth: z.string()
    .refine((date) => !isNaN(Date.parse(date)), { message: 'Invalid date format' })
    .refine((date) => {
      const birth = new Date(date);
      const minAge = new Date(); minAge.setFullYear(minAge.getFullYear() - 16);
      const maxAge = new Date(); maxAge.setFullYear(maxAge.getFullYear() - 10);
      return birth >= minAge && birth <= maxAge;
    }, { message: 'Child must be between 10 and 16 years old' }),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).optional(),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits').optional(),
  email: z.string().email().optional(),
  gender: z.enum(['boy', 'girl']).optional(),
});

/** HH:MM, 24-hour. Shared by the quiet-hours fields below. */
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

const updateChildSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).optional(),
  avatarUrl: z.string().url().optional(),
  // FR-10: the schema has carried avatarEmoji since M10 but this endpoint never accepted it, so
  // there was no way to set it. Constrained to a short string (an emoji can be several code
  // points — flags and ZWJ sequences are long) and validated against the picker's own list so a
  // child cannot store arbitrary text where the UI expects a glyph.
  avatarEmoji: z
    .string()
    .min(1)
    .max(16)
    .refine((v) => (AVATAR_EMOJIS as readonly string[]).includes(v), {
      message: 'Not an allowed avatar emoji',
    })
    .nullable()
    .optional(),
  gender: z.enum(['boy', 'girl']).optional(),
  // U16 — quiet hours / schooltime. HH:MM in the FAMILY's timezone (see QuietHoursService); the
  // regex is the boundary validation, so an unparseable string never reaches the evaluator.
  quietHoursEnabled: z.boolean().optional(),
  quietHoursStart: z.string().regex(HM, 'Time must be HH:MM').optional(),
  quietHoursEnd: z.string().regex(HM, 'Time must be HH:MM').optional(),
  schooltimeEnabled: z.boolean().optional(),
  schooltimeStart: z.string().regex(HM, 'Time must be HH:MM').optional(),
  schooltimeEnd: z.string().regex(HM, 'Time must be HH:MM').optional(),
  // ISO weekdays, 1 = Monday .. 7 = Sunday.
  schooltimeDays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
});

const updateSettingsSchema = z.object({
  autoApproveRecurringTasks: z.boolean().optional(),
  enableDailyChallenges: z.boolean().optional(),
  enableLeaderboard: z.boolean().optional(),
  streakGracePeriodHours: z.number().min(0).max(12).optional(),
  theme: z.string().optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
});

const updateFamilySchema = z.object({
  familyName: z.string().min(2).max(100),
});

// M4: Schema for sending a co-parent invitation
const inviteCoParentSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

// GET /families/me - Get current family
familyRouter.get('/me', async (req, res, next) => {
  try {
    const family = await prisma.family.findUnique({
      where: { id: req.familyId },
      include: {
        settings: true,
      },
    });

    if (!family) {
      throw new NotFoundError('Family not found');
    }

    res.json({
      success: true,
      data: { family },
    });
  } catch (error) {
    next(error);
  }
});

// GET /families/me/export - GDPR data export: full JSON bundle of the family's own data (parent only).
// Rate-limited to once per day per parent (data export can be heavy and is abuse-sensitive).
const exportLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as { user?: { userId?: string } }).user?.userId ?? 'anonymous',
  message: { success: false, error: { message: 'Data export is limited to once per day. Please try again tomorrow.' } },
});

familyRouter.get('/me/export', requireParent, exportLimiter, async (req, res, next) => {
  try {
    const familyId = req.familyId!;

    const users = await prisma.user.findMany({
      where: { familyId },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true,
        dateOfBirth: true, createdAt: true,
        childProfile: { select: { pointsBalance: true, totalXpEarned: true, currentStreakDays: true, ageGroup: true } },
      },
    });
    const childIds = users.filter((u) => u.role === 'child').map((u) => u.id);

    const [family, tasks, rewards, redemptions, points, achievements, evidence] = await Promise.all([
      prisma.family.findUnique({ where: { id: familyId }, include: { settings: true } }),
      prisma.task.findMany({ where: { familyId }, include: { assignments: true } }),
      prisma.reward.findMany({ where: { familyId } }),
      prisma.rewardRedemption.findMany({ where: { childId: { in: childIds } } }),
      prisma.pointsLedger.findMany({ where: { childId: { in: childIds } } }),
      prisma.childAchievement.findMany({ where: { childId: { in: childIds } } }),
      // Evidence: keys only (the objects themselves are private; keys let the owner cross-reference).
      prisma.taskEvidence.findMany({
        where: { assignment: { task: { familyId } } },
        select: { id: true, evidenceType: true, fileKey: true, mimeType: true, uploadedAt: true },
      }),
    ]);

    res.setHeader('Content-Disposition', `attachment; filename="taskbuddy-export-${familyId}.json"`);
    res.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        family, users, tasks, rewards, redemptions, points, achievements, evidenceKeys: evidence,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /families/me - Update family info
familyRouter.put('/me', requireParent, validateBody(updateFamilySchema), async (req, res, next) => {
  try {
    const family = await prisma.family.update({
      where: { id: req.familyId },
      data: {
        familyName: req.body.familyName,
      },
      include: {
        settings: true,
      },
    });

    // M8 - Audit: family name updated
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'family',
      resourceId: req.familyId!,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { familyName: req.body.familyName },
    });

    res.json({
      success: true,
      data: { family },
    });
  } catch (error) {
    next(error);
  }
});

// GET /families/me/members - List all family members
familyRouter.get('/me/members', async (req, res, next) => {
  try {
    const members = await prisma.user.findMany({
      where: {
        familyId: req.familyId,
        deletedAt: null,
      },
      include: {
        childProfile: true,
      },
      orderBy: [
        { role: 'asc' }, // Parents first
        { createdAt: 'asc' },
      ],
    });

    // Remove sensitive data
    const sanitizedMembers = members.map((member) => {
      const { passwordHash, ...user } = member;
      const profile = member.childProfile
        ? { ...member.childProfile, pinHash: undefined }
        : undefined;
      return { ...user, childProfile: profile };
    });

    res.json({
      success: true,
      data: { members: sanitizedMembers },
    });
  } catch (error) {
    next(error);
  }
});

// ─── M4: Co-parent management ─────────────────────────────────────────────────

// POST /families/me/invite - Send a co-parent invitation email
familyRouter.post('/me/invite', requireParent, validateBody(inviteCoParentSchema), async (req, res, next) => {
  try {
    const { acceptUrl, emailSent } = await inviteService.sendInvite({
      familyId: req.familyId!,
      invitedByUserId: req.user!.userId,
      email: req.body.email,
    });

    // M8 - Audit: co-parent invitation sent
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'INVITE_SENT',
      resourceType: 'invitation',
      resourceId: req.familyId!,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { invitedEmail: req.body.email, emailSent },
    });

    res.json({
      success: true,
      data: {
        message: emailSent
          ? `Invitation sent to ${req.body.email}`
          : `Invitation created. Email delivery failed - use the link below to share manually.`,
        acceptUrl,
        emailSent,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /families/me/parents - List all parent-role users + pending invites
familyRouter.get('/me/parents', requireParent, async (req, res, next) => {
  try {
    const result = await inviteService.listParents(req.familyId!);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /families/me/parents/:id - Remove a co-parent (primary parent only)
familyRouter.delete('/me/parents/:id', requireParent, async (req, res, next) => {
  try {
    await inviteService.removeParent(
      req.familyId!,
      req.user!.userId,
      req.params.id
    );

    // M8 - Audit: co-parent removed
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'DELETE',
      resourceType: 'user',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { event: 'co_parent_removed' },
    });

    res.json({
      success: true,
      data: { message: 'Co-parent removed from family' },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /families/me/invitations/:id - Cancel a pending invitation
familyRouter.delete('/me/invitations/:id', requireParent, async (req, res, next) => {
  try {
    await inviteService.cancelInvite(
      req.familyId!,
      req.user!.userId,
      req.params.id
    );

    // M8 - Audit: pending invitation cancelled
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'DELETE',
      resourceType: 'invitation',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { event: 'invitation_cancelled' },
    });

    res.json({
      success: true,
      data: { message: 'Invitation cancelled' },
    });
  } catch (error) {
    next(error);
  }
});

// ─── Children ─────────────────────────────────────────────────────────────────

// POST /families/me/children - Add a child to the family
familyRouter.post('/me/children', requireParent, validateBody(addChildSchema), async (req, res, next) => {
  try {
    // COPPA gate (growth roadmap §3.2): no child data is collected until a parent has completed
    // verifiable consent. A POSITIVE check, so a missing record can never accidentally permit
    // collection. The CONSENT_REQUIRED code lets the UI route to the consent screen rather than
    // showing a generic 403.
    if (!(await ConsentService.hasVerifiedConsent(req.familyId!))) {
      throw new AppError(
        403,
        'CONSENT_REQUIRED',
        'Please confirm you are the parent before adding a child. We have sent you an email, or you can request a new one from Settings.',
      );
    }

    const result = await authService.addChild({
      familyId: req.familyId!,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      dateOfBirth: new Date(req.body.dateOfBirth),
      username: req.body.username,
      pin: req.body.pin,
      createdBy: req.user!.userId,
      email: req.body.email,
      gender: req.body.gender,
    });

    const createdChildId = (result as any).user?.id || (result as any).id;

    // M8 - Audit: child added to family
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'child',
      resourceId: createdChildId,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { firstName: req.body.firstName, lastName: req.body.lastName },
    });

    // GDPR-K: record the parent's consent (given on the child's behalf) at child creation.
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CONSENT',
      resourceType: 'child',
      resourceId: createdChildId,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { tosVersion: CONSENT_VERSIONS.tos, privacyVersion: CONSENT_VERSIONS.privacy, context: 'child_create' },
    });

    // M9 - fire-and-forget child welcome email (only when email was provided)
    if (req.body.email) {
      prisma.family.findUnique({ where: { id: req.familyId! } })
        .then((family) => {
          EmailService.send({
            triggerType: 'child_welcome',
            toEmail: req.body.email,
            toUserId: createdChildId,
            familyId: req.familyId!,
            subject: `Welcome to TaskBuddy, ${req.body.firstName}!`,
            templateData: {
              childFirstName: req.body.firstName,
              childLastName: req.body.lastName,
              username: req.body.username || '',
              familyCode: family?.familyCode || '',
              appUrl: process.env.CLIENT_URL || 'http://localhost:3000',
            },
            skipPreferenceCheck: true,
          }).catch((err: Error) => console.error('[child_welcome email]', err.message));
        })
        .catch((err: Error) => console.error('[child_welcome email] family fetch failed', err.message));
    }

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// GET /families/me/children/:id - Get a specific child
familyRouter.get('/me/children/:id', async (req, res, next) => {
  try {
    const child = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        role: 'child',
        deletedAt: null,
      },
      include: {
        childProfile: true,
      },
    });

    if (!child) {
      throw new NotFoundError('Child not found');
    }

    // Remove sensitive data
    const { passwordHash, ...user } = child;
    const profile = child.childProfile
      ? { ...child.childProfile, pinHash: undefined }
      : undefined;

    res.json({
      success: true,
      data: { child: { ...user, childProfile: profile } },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /families/me/my-avatar — a child sets their own avatar emoji (FR-10).
 *
 * The parent-facing PUT /me/children/:id is requireParent, so a child cannot use it. This route is
 * scoped to the caller's own profile: it takes no id, deriving the child from the token, so it
 * cannot be pointed at a sibling.
 */
familyRouter.put(
  '/me/my-avatar',
  requireChild,
  validateBody(z.object({ avatarEmoji: updateChildSchema.shape.avatarEmoji })),
  async (req, res, next) => {
    try {
      const profile = await prisma.childProfile.update({
        where: { userId: req.user!.userId },
        data: { avatarEmoji: req.body.avatarEmoji ?? null },
        select: { userId: true, avatarEmoji: true },
      });
      res.json({ success: true, data: { profile } });
    } catch (error) {
      next(error);
    }
  },
);

// PUT /families/me/children/:id - Update a child
familyRouter.put('/me/children/:id', requireParent, validateBody(updateChildSchema), async (req, res, next) => {
  try {
    const child = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        role: 'child',
        deletedAt: null,
      },
    });

    if (!child) {
      throw new NotFoundError('Child not found');
    }

    const updatedChild = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        username: req.body.username?.toLowerCase(),
        avatarUrl: req.body.avatarUrl,
        ...(req.body.gender !== undefined ? { gender: req.body.gender } : {}),
        // avatarEmoji lives on ChildProfile, not User — nested update, and only when supplied so
        // an unrelated PUT never clears the child's chosen avatar.
        ...(req.body.avatarEmoji !== undefined
          ? { childProfile: { update: { avatarEmoji: req.body.avatarEmoji } } }
          : {}),
        // U16 — each applied only when supplied, so a PUT that renames a child never silently
        // switches their quiet hours off.
        ...(req.body.quietHoursEnabled !== undefined ? { quietHoursEnabled: req.body.quietHoursEnabled } : {}),
        ...(req.body.quietHoursStart !== undefined ? { quietHoursStart: req.body.quietHoursStart } : {}),
        ...(req.body.quietHoursEnd !== undefined ? { quietHoursEnd: req.body.quietHoursEnd } : {}),
        ...(req.body.schooltimeEnabled !== undefined ? { schooltimeEnabled: req.body.schooltimeEnabled } : {}),
        ...(req.body.schooltimeStart !== undefined ? { schooltimeStart: req.body.schooltimeStart } : {}),
        ...(req.body.schooltimeEnd !== undefined ? { schooltimeEnd: req.body.schooltimeEnd } : {}),
        ...(req.body.schooltimeDays !== undefined ? { schooltimeDays: req.body.schooltimeDays } : {}),
      },
      include: {
        childProfile: true,
      },
    });

    // Remove sensitive data
    const { passwordHash, ...user } = updatedChild;
    const profile = updatedChild.childProfile
      ? { ...updatedChild.childProfile, pinHash: undefined }
      : undefined;

    // M8 - Audit: child profile updated by parent
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'child',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { changes: req.body },
    });

    // M9 - fire-and-forget child_profile_updated email when name/username changed
    if (updatedChild.email) {
      const changed: string[] = [];
      if (req.body.firstName && req.body.firstName !== child.firstName) changed.push('first name');
      if (req.body.lastName && req.body.lastName !== child.lastName) changed.push('last name');
      if (req.body.username && req.body.username !== child.username) changed.push('username');
      if (changed.length > 0) {
        EmailService.send({
          triggerType: 'child_profile_updated',
          toEmail: updatedChild.email,
          toUserId: updatedChild.id,
          familyId: req.familyId!,
          subject: `Your TaskBuddy profile was updated`,
          templateData: {
            childFirstName: updatedChild.firstName,
            changed: changed.join(', '),
            newFirstName: updatedChild.firstName,
            newLastName: updatedChild.lastName,
            newUsername: updatedChild.username || '',
            appUrl: process.env.CLIENT_URL || 'http://localhost:3000',
          },
          skipPreferenceCheck: true,
        }).catch((err: Error) => console.error('[child_profile_updated email]', err.message));
      }
    }

    res.json({
      success: true,
      data: { child: { ...user, childProfile: profile } },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /families/me/children/:id - Deactivate a child (soft delete)
familyRouter.delete('/me/children/:id', requireParent, async (req, res, next) => {
  try {
    const child = await prisma.user.findFirst({
      where: {
        id: req.params.id,
        familyId: req.familyId,
        role: 'child',
        deletedAt: null,
      },
    });

    if (!child) {
      throw new NotFoundError('Child not found');
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });

    // M8 - Audit: child account deactivated by parent
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'DELETE',
      resourceType: 'child',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { childName: `${child.firstName} ${child.lastName}` },
    });

    res.json({
      success: true,
      data: { message: 'Child account deactivated' },
    });
  } catch (error) {
    next(error);
  }
});

// GET /families/me/settings - Get family settings
familyRouter.get('/me/settings', async (req, res, next) => {
  try {
    let settings = await prisma.familySettings.findUnique({
      where: { familyId: req.familyId },
    });

    // Create default settings if not exists
    if (!settings) {
      settings = await prisma.familySettings.create({
        data: { familyId: req.familyId! },
      });
    }

    res.json({
      success: true,
      data: { settings },
    });
  } catch (error) {
    next(error);
  }
});

// PUT /families/me/settings - Update family settings
familyRouter.put('/me/settings', requireParent, validateBody(updateSettingsSchema), async (req, res, next) => {
  try {
    const settings = await prisma.familySettings.upsert({
      where: { familyId: req.familyId },
      update: req.body,
      create: {
        familyId: req.familyId!,
        ...req.body,
      },
    });

    res.json({
      success: true,
      data: { settings },
    });
  } catch (error) {
    next(error);
  }
});

// M5 - POST /families/children/capacities - Get task capacity for multiple children
const childCapacitiesSchema = z.object({
  childIds: z.array(z.string().uuid()).min(1).max(20),
});

familyRouter.post(
  '/children/capacities',
  requireParent,
  validateBody(childCapacitiesSchema),
  async (req, res, next) => {
    try {
      const { childIds } = req.body as z.infer<typeof childCapacitiesSchema>;

      // Verify all children belong to the requesting parent's family
      const children = await prisma.user.findMany({
        where: {
          id: { in: childIds },
          familyId: req.familyId,
          role: 'child',
          deletedAt: null,
        },
        select: { id: true },
      });

      if (children.length !== childIds.length) {
        throw new NotFoundError('One or more children not found in your family');
      }

      // Fetch capacity for each child
      const capacities: Record<string, ChildCapacity> = {};
      for (const childId of childIds) {
        capacities[childId] = await getChildCapacity(childId);
      }

      res.json({
        success: true,
        data: { capacities },
      });
    } catch (error) {
      next(error);
    }
  }
);