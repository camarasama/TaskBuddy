import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { CONSENT_VERSIONS, AVATAR_EMOJIS, AGE_LIMITS, isAgeBetween } from '@taskbuddy/shared';
import { ConsentService } from '../services/ConsentService';
import { TransitionService } from '../services/TransitionService';
import { AppError } from '../middleware/errorHandler';
import { prisma } from '../services/database';
import { authService } from '../services/auth';
import { inviteService } from '../services/invite';
import { authenticate, requireParent, requireChild, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { NotFoundError, ForbiddenError, ConflictError } from '../middleware/errorHandler';
// M5 - import capacity utility
import { getChildCapacity, type ChildCapacity } from '../utils/assignmentLimits';
// M8 - Audit logging for all mutating family routes
import { getReferralSummary } from '../services/ReferralService';
import { AuditService } from '../services/AuditService';
import { MAX_STREAK_PAUSE_DAYS } from '../services/streakService';
import { GRACE_GRANT_HOURS } from '@taskbuddy/shared';
// M9 - Email notifications
import { EmailService } from '../services/email';
import { isOwnStorageUrl } from '../services/storage';
import { createNotification } from './notifications';

export const familyRouter = Router();

// All family routes require authentication and family isolation
familyRouter.use(authenticate, familyIsolation);

// Validation schemas
const addChildSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  dateOfBirth: z.string()
    .refine((date) => !isNaN(Date.parse(date)), { message: 'Invalid date format' })
    .refine((date) => isAgeBetween(date, AGE_LIMITS.CHILD_MIN, AGE_LIMITS.CHILD_MAX), {
      message: `Child must be between ${AGE_LIMITS.CHILD_MIN} and ${AGE_LIMITS.CHILD_MAX} years old`,
    }),
  // Required: the username is what the child types to log in. Two siblings can share a first
  // name, so the login handle has to be a field of its own.
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits').optional(),
  email: z.string().email().optional(),
  gender: z.enum(['boy', 'girl']).optional(),
  /**
   * The parental consent tick from the create-child form.
   *
   * `z.literal(true)` rather than `z.boolean()`: absent, `false`, `"false"` and `0` must all be
   * refusals. A boolean that merely has to be present would accept `false` and record a consent
   * nobody gave, which is the one failure mode this field exists to prevent.
   *
   * It does NOT replace the verifiable consent gate above. That one proves the parent is who they
   * say they are; this records that they read the statement for this specific child.
   */
  consentFormAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Parental consent must be given before adding a child' }),
  }),
});

/** HH:MM, 24-hour. Shared by the quiet-hours fields below. */
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Vacation mode (growth roadmap §11.2). Plain `YYYY-MM-DD` strings: a holiday is a range of days, and
 * accepting a timestamp would invite a timezone argument about which day someone flew home.
 *
 * Forward-only and bounded, both enforced here rather than in the service, because both are product
 * rules about what a parent may ask for rather than arithmetic about what a streak does.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const streakPauseSchema = z
  .object({
    from: z.string().regex(DAY, 'Use YYYY-MM-DD'),
    until: z.string().regex(DAY, 'Use YYYY-MM-DD'),
  })
  .refine((v) => v.until >= v.from, { message: 'The end date cannot be before the start date' })
  .refine(
    (v) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const until = new Date(`${v.until}T00:00:00`);
      return until >= today;
    },
    {
      // Forward-only: a pause over days already lost would mean rebuilding a streak the child has
      // already watched reset, rewriting a number they saw. Answered by the owner, 2026-08-26.
      message: 'A pause cannot end in the past. Streaks already missed cannot be restored.',
    },
  )
  .refine(
    (v) => {
      const from = new Date(`${v.from}T00:00:00`);
      const until = new Date(`${v.until}T00:00:00`);
      return Math.floor((until.getTime() - from.getTime()) / 86_400_000) + 1 <= MAX_STREAK_PAUSE_DAYS;
    },
    { message: `A pause can cover at most ${MAX_STREAK_PAUSE_DAYS} days` },
  );

const updateChildSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).optional(),
  // Nullable so a parent can REMOVE an approved photo, not just replace it. Prisma treats
  // undefined as "leave alone" and null as "clear", which is exactly the distinction needed.
  avatarUrl: z.string().url().nullable().optional(),
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
      // Send the email here, on first refusal, because nothing else ever does. Registration does
      // not request consent, so before this the 403 told a parent to check an inbox that no email
      // had been sent to, and the only screen that could fix it was one they had no reason to
      // visit. `getStatus` reports an expired pending request as 'none', so this also recovers a
      // family whose link timed out.
      const { status } = await ConsentService.getStatus(req.familyId!);
      let emailed = false;
      if (status === 'none') {
        try {
          await ConsentService.requestConsent({
            familyId: req.familyId!,
            parentId: req.user!.userId,
          });
          emailed = true;
        } catch (err) {
          // A failed send must not change the outcome. The gate still refuses, and the parent can
          // retry from the consent screen; swallowing it here only costs them one extra tap.
          console.error('[family] consent auto-request failed:', (err as Error)?.message);
        }
      }

      throw new AppError(
        403,
        'CONSENT_REQUIRED',
        emailed
          ? "We've emailed you a link to confirm you're the parent. Follow it and you can add your children straight away."
          : 'Please follow the link we emailed you to confirm you are the parent. You can send a new one if it has gone astray.',
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
      metadata: {
        tosVersion: CONSENT_VERSIONS.tos,
        privacyVersion: CONSENT_VERSIONS.privacy,
        formVersion: CONSENT_VERSIONS.form,
        context: 'child_create',
      },
    });

    // Tell every adult on the account, not just whoever pressed the button. A co-parent finding out
    // that a child was added, and that consent was recorded in their family's name, is the point:
    // it is the check on one parent acting alone.
    EmailService.sendToFamilyParents({
      familyId: req.familyId!,
      triggerType: 'parental_consent_recorded',
      // Subject fixed by the brief, including the lowercase 'b'. Do not "correct" it to BRAND_NAME
      // without asking — it was specified verbatim.
      subjectBuilder: () => 'Parental Consent Recorded - Taskbuddy',
      templateData: {
        childFirstName: req.body.firstName,
        formVersion: CONSENT_VERSIONS.form,
        recordedAt: new Date().toISOString(),
      },
      referenceType: 'child',
      referenceId: createdChildId,
    }).catch((err) =>
      // Fire and forget: the child exists and consent is recorded in the audit log either way.
      // Failing the request here would leave a created child looking like a failed creation.
      console.error('[family] consent-recorded email failed:', (err as Error)?.message),
    );

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

/**
 * PUT /families/me/my-avatar-photo — a child proposes their own profile photo.
 *
 * The photo does NOT become their avatar here. It is parked on childProfile.pendingAvatarUrl until
 * a parent approves it below. The emoji picker is a fixed allow-list because that field is
 * child-controlled and family-visible; a photo cannot be allow-listed, so a parent is the gate.
 *
 * Send `{ avatarUrl: null }` to withdraw a pending photo.
 */
familyRouter.put(
  '/me/my-avatar-photo',
  requireChild,
  validateBody(z.object({ avatarUrl: z.string().url().nullable() })),
  async (req, res, next) => {
    try {
      const submitted: string | null = req.body.avatarUrl;

      // The client supplies this URL and a PARENT's browser will load it. Without an origin check
      // a child could submit any third-party URL — a tracking beacon, or unmoderated content.
      if (submitted !== null && !isOwnStorageUrl(submitted)) {
        throw new ForbiddenError('That image must be uploaded through TaskBuddy.');
      }

      const profile = await prisma.childProfile.update({
        where: { userId: req.user!.userId },
        data: {
          pendingAvatarUrl: submitted,
          pendingAvatarAt: submitted ? new Date() : null,
        },
        select: { userId: true, pendingAvatarUrl: true, pendingAvatarAt: true },
      });

      if (submitted) {
        const child = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { firstName: true, familyId: true },
        });
        const parents = await prisma.user.findMany({
          where: { familyId: child?.familyId ?? undefined, role: 'parent', deletedAt: null },
          select: { id: true },
        });
        await Promise.all(
          parents.map((parent) =>
            createNotification({
              userId: parent.id,
              notificationType: 'child_avatar_pending',
              title: 'New profile photo to review',
              message: `${child?.firstName ?? 'Your child'} chose a new profile photo. Approve it or choose another.`,
              actionUrl: `/parent/children/${req.user!.userId}`,
              referenceType: 'child_avatar',
              referenceId: req.user!.userId,
            }),
          ),
        );
      }

      res.json({ success: true, data: { profile } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /families/me/children/:id/avatar/approve — parent promotes the pending photo to the
 * child's real avatar. POST …/reject discards it. Both are requireParent + familyIsolation, so a
 * parent can only act on their own children.
 */
function reviewChildAvatar(approved: boolean): RequestHandler {
  return async (req, res, next) => {
  try {
    const child = await prisma.user.findFirst({
      where: { id: req.params.id, familyId: req.familyId, role: 'child', deletedAt: null },
      include: { childProfile: true },
    });

    if (!child || !child.childProfile) {
      throw new NotFoundError('Child not found');
    }
    if (!child.childProfile.pendingAvatarUrl) {
      throw new NotFoundError('There is no photo waiting for review');
    }

    const pending = child.childProfile.pendingAvatarUrl;

    await prisma.$transaction([
      prisma.childProfile.update({
        where: { userId: child.id },
        data: { pendingAvatarUrl: null, pendingAvatarAt: null },
      }),
      ...(approved
        ? [prisma.user.update({ where: { id: child.id }, data: { avatarUrl: pending } })]
        : []),
    ]);

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'child',
      resourceId: child.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { childAvatar: approved ? 'approved' : 'rejected' },
    });

    await createNotification({
      userId: child.id,
      notificationType: 'child_avatar_reviewed',
      title: approved ? 'Your new photo is live!' : 'Photo not approved',
      message: approved
        ? 'Your parent approved your profile photo.'
        : 'Your parent did not approve that photo. You can pick a different one.',
      actionUrl: '/child/settings',
      referenceType: 'child_avatar',
      referenceId: child.id,
    });

    res.json({ success: true, data: { approved, avatarUrl: approved ? pending : child.avatarUrl } });
  } catch (error) {
    next(error);
  }
  };
}

familyRouter.post('/me/children/:id/avatar/approve', requireParent, reviewChildAvatar(true));
familyRouter.post('/me/children/:id/avatar/reject', requireParent, reviewChildAvatar(false));

/**
 * Vacation mode (growth roadmap §11.2).
 *
 *   PUT    /families/me/children/:id/streak-pause   - open or replace a pause
 *   DELETE /families/me/children/:id/streak-pause   - cancel it
 *   PUT    /families/me/streak-pause                - the same range for every child in the family
 *
 * A pause preserves a streak across days nobody was home. It never advances one: a week away must not
 * out-earn a week of chores. Tasks actually completed during a pause still count normally, so a child
 * who does chores on holiday is not penalised for it either.
 *
 * Parent-only, and scoped by `req.familyId`, so a parent cannot pause a child in another family.
 */
async function findOwnChild(childId: string, familyId: string | undefined) {
  const child = await prisma.user.findFirst({
    where: { id: childId, familyId, role: 'child', deletedAt: null },
    select: { id: true, firstName: true },
  });
  if (!child) throw new NotFoundError('Child not found');
  return child;
}

familyRouter.put(
  '/me/children/:id/streak-pause',
  requireParent,
  validateBody(streakPauseSchema),
  async (req, res, next) => {
    try {
      const child = await findOwnChild(req.params.id, req.familyId);
      const { from, until } = req.body as { from: string; until: string };

      await prisma.childProfile.update({
        where: { userId: child.id },
        data: {
          streakPausedFrom: new Date(`${from}T00:00:00.000Z`),
          streakPausedUntil: new Date(`${until}T00:00:00.000Z`),
        },
      });

      // A parent action that changes what a child's record will do. Audited like the other overrides.
      await AuditService.logAction({
        actorId: req.user!.userId,
        action: 'STREAK_PAUSE_SET',
        resourceType: 'user',
        resourceId: child.id,
        familyId: req.familyId,
        ipAddress: req.ip,
        metadata: { from, until },
      });

      res.json({ success: true, data: { childId: child.id, from, until } });
    } catch (error) {
      next(error);
    }
  },
);

familyRouter.delete('/me/children/:id/streak-pause', requireParent, async (req, res, next) => {
  try {
    const child = await findOwnChild(req.params.id, req.familyId);

    await prisma.childProfile.update({
      where: { userId: child.id },
      data: { streakPausedFrom: null, streakPausedUntil: null },
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'STREAK_PAUSE_CLEARED',
      resourceType: 'user',
      resourceId: child.id,
      familyId: req.familyId,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { childId: child.id, from: null, until: null } });
  } catch (error) {
    next(error);
  }
});

/** The whole family at once, which is what a holiday actually is. Fans out to each child rather than
 *  storing a second family-level source of truth that the per-child value could then disagree with. */
familyRouter.put(
  '/me/streak-pause',
  requireParent,
  validateBody(streakPauseSchema),
  async (req, res, next) => {
    try {
      const { from, until } = req.body as { from: string; until: string };
      const children = await prisma.user.findMany({
        where: { familyId: req.familyId, role: 'child', deletedAt: null },
        select: { id: true },
      });

      await prisma.childProfile.updateMany({
        where: { userId: { in: children.map((c) => c.id) } },
        data: {
          streakPausedFrom: new Date(`${from}T00:00:00.000Z`),
          streakPausedUntil: new Date(`${until}T00:00:00.000Z`),
        },
      });

      await AuditService.logAction({
        actorId: req.user!.userId,
        action: 'STREAK_PAUSE_SET_FAMILY',
        resourceType: 'family',
        resourceId: req.familyId!,
        familyId: req.familyId,
        ipAddress: req.ip,
        metadata: { from, until, childCount: children.length },
      });

      res.json({ success: true, data: { childCount: children.length, from, until } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * One-off grace grant (growth roadmap §11.3).
 *
 *   POST   /families/me/children/:id/grace-grant   - hold the streak for GRACE_GRANT_HOURS
 *   DELETE /families/me/children/:id/grace-grant   - take it back
 *
 * The standing `FamilySettings.streakGracePeriodHours` is a policy: every day, every child, measured
 * in hours past midnight. This is a response to one evening, for one child, and it expires by itself.
 * `graceDeadlineFor` takes the LATER of the two, so a grant can only ever extend, never shorten.
 *
 * Streak only. The task's own expiry is untouched (owner decision, 2026-08-26), so a granted evening
 * cannot quietly move a deadline the child is still expected to meet.
 *
 * No body: the duration is fixed, which is what makes this one tap on a phone at 9pm.
 */
familyRouter.post('/me/children/:id/grace-grant', requireParent, async (req, res, next) => {
  try {
    const child = await findOwnChild(req.params.id, req.familyId);
    const until = new Date(Date.now() + GRACE_GRANT_HOURS * 60 * 60 * 1000);

    await prisma.childProfile.update({
      where: { userId: child.id },
      data: { graceGrantedUntil: until },
    });

    // A parent action that changes what a child's record will do, so it is audited like the pause
    // and the other overrides rather than left as an invisible state change.
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'STREAK_GRACE_GRANTED',
      resourceType: 'user',
      resourceId: child.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { until: until.toISOString(), hours: GRACE_GRANT_HOURS },
    });

    res.json({ success: true, data: { childId: child.id, graceGrantedUntil: until.toISOString() } });
  } catch (error) {
    next(error);
  }
});

familyRouter.delete('/me/children/:id/grace-grant', requireParent, async (req, res, next) => {
  try {
    const child = await findOwnChild(req.params.id, req.familyId);

    await prisma.childProfile.update({
      where: { userId: child.id },
      data: { graceGrantedUntil: null },
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'STREAK_GRACE_CLEARED',
      resourceType: 'user',
      resourceId: child.id,
      familyId: req.familyId,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: { childId: child.id, graceGrantedUntil: null } });
  } catch (error) {
    next(error);
  }
});

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

    // Renaming a child must not collide with a sibling. There was no check on this path at all,
    // so a parent could point two children at the same login handle and make one of them
    // unable to sign in. The DB unique index refuses it now; this turns that raw constraint
    // violation into something a parent can act on.
    if (req.body.username !== undefined) {
      const desiredUsername = req.body.username.trim().toLowerCase();
      const clash = await prisma.user.findFirst({
        where: {
          familyId: req.familyId,
          username: desiredUsername,
          NOT: { id: req.params.id },
        },
      });
      if (clash) {
        throw new ConflictError('That username is already taken in this family');
      }
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
/**
 * GET /families/me/referral — the family's share link and progress (growth roadmap §7).
 *
 * Returns a COUNT of families referred, never a list: who signed up is their business, not this
 * family's. The reward is a badge and nothing else — no points, no unlock — because anything with
 * in-app value creates a reason to game it, and children are the only people here to game.
 */
familyRouter.get('/me/referral', requireParent, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getReferralSummary(req.familyId!) });
  } catch (error) {
    next(error);
  }
});

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

// ─── Aging out (workstream 4) ────────────────────────────────────────────────

/**
 * GET /families/me/transitions — children on this family who have turned 18 and await a decision.
 *
 * Parent-only, and family-scoped by `req.familyId` rather than by anything the caller sends, so a
 * transition id cannot be fished for across families.
 */
familyRouter.get('/me/transitions', requireParent, async (req, res, next) => {
  try {
    const transitions = await prisma.accountTransition.findMany({
      where: { familyId: req.familyId!, status: 'pending' },
      orderBy: { detectedAt: 'asc' },
    });

    // The recipients a parent may choose from. Resolved here rather than on the client so the list
    // cannot include a child the server would then refuse.
    const siblings = await prisma.user.findMany({
      where: {
        familyId: req.familyId!,
        role: 'child',
        deletedAt: null,
        id: { notIn: transitions.map((t) => t.childId) },
      },
      select: { id: true, firstName: true, lastName: true },
    });

    const children = await prisma.user.findMany({
      where: { id: { in: transitions.map((t) => t.childId) } },
      select: { id: true, firstName: true, lastName: true, childProfile: { select: { pointsBalance: true } } },
    });

    res.json({ success: true, data: { transitions, siblings, children } });
  } catch (error) {
    next(error);
  }
});

const resolveTransitionSchema = z.object({
  decision: z.enum(['transfer', 'discard', 'invite']),
  transferToChildId: z.string().uuid().optional(),
});

/** POST /families/me/transitions/:id/resolve — the parent's decision. */
familyRouter.post(
  '/me/transitions/:id/resolve',
  requireParent,
  validateBody(resolveTransitionSchema),
  async (req, res, next) => {
    try {
      const updated = await TransitionService.resolveTransition({
        transitionId: req.params.id,
        familyId: req.familyId!,
        actorId: req.user!.userId,
        decision: req.body.decision,
        transferToChildId: req.body.transferToChildId,
        ipAddress: req.ip,
      });

      res.json({ success: true, data: { transition: updated } });
    } catch (error) {
      next(error);
    }
  },
);
