import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authService } from '../services/auth';
import { inviteService } from '../services/invite';
import { authenticate, requireParent, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { NotFoundError, ForbiddenError } from '../middleware/errorHandler';
// M5 — import capacity utility
import { getChildCapacity, type ChildCapacity } from '../utils/assignmentLimits';
// M8 — Audit logging for all mutating family routes
import { AuditService } from '../services/AuditService';

export const familyRouter = Router();

// All family routes require authentication and family isolation
familyRouter.use(authenticate, familyIsolation);

// Validation schemas
const addChildSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  dateOfBirth: z.string().refine((date) => !isNaN(Date.parse(date)), {
    message: 'Invalid date format',
  }),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).optional(),
  pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits').optional(),
});

const updateChildSchema = z.object({
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).optional(),
  avatarUrl: z.string().url().optional(),
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

    // M8 — Audit: family name updated
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

    // M8 — Audit: co-parent invitation sent
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
          : `Invitation created. Email delivery failed — use the link below to share manually.`,
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

    // M8 — Audit: co-parent removed
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

    // M8 — Audit: pending invitation cancelled
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
    const result = await authService.addChild({
      familyId: req.familyId!,
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      dateOfBirth: new Date(req.body.dateOfBirth),
      username: req.body.username,
      pin: req.body.pin,
      createdBy: req.user!.userId,
    });

    // M8 — Audit: child added to family
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'child',
      resourceId: (result as any).user?.id || (result as any).id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { firstName: req.body.firstName, lastName: req.body.lastName },
    });

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

    // M8 — Audit: child profile updated by parent
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'child',
      resourceId: req.params.id,
      familyId: req.familyId,
      ipAddress: req.ip,
      metadata: { changes: req.body },
    });

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

    // M8 — Audit: child account deactivated by parent
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

// M5 — POST /families/children/capacities - Get task capacity for multiple children
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