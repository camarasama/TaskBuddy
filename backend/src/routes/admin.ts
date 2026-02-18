/**
 * routes/admin.ts — M8
 *
 * All /api/v1/admin/* endpoints. Every route in this file requires the
 * requireAdmin middleware — non-admin requests are rejected with 403.
 *
 * Routes:
 *   GET  /admin/overview                     — Platform health stats
 *   GET  /admin/families                     — Paginated family list
 *   GET  /admin/families/:id                 — Family detail (read-only)
 *   PATCH /admin/families/:id/suspend        — Suspend a family
 *   PATCH /admin/families/:id/reactivate     — Reactivate a suspended family
 *   GET  /admin/users                        — Cross-family user search
 *   GET  /admin/users/:id                    — User detail
 *   POST /admin/users/:id/force-reset        — Trigger password reset
 *   GET  /admin/achievements                 — List global achievements
 *   POST /admin/achievements                 — Create global achievement
 *   PUT  /admin/achievements/:id             — Edit global achievement
 *   DELETE /admin/achievements/:id           — Delete global achievement
 *   GET  /admin/audit-logs                   — Paginated, filterable audit log
 *   GET  /admin/audit-logs/export            — CSV export of audit log
 *
 * Note: POST /auth/admin/register lives in routes/auth.ts (it's a public
 * endpoint gated by ADMIN_INVITE_CODE, not by the admin JWT guard).
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../services/database';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validateBody, validateQuery } from '../middleware/validate';
import { NotFoundError } from '../middleware/errorHandler';
import { AuditService } from '../services/AuditService';

export const adminRouter = Router();

// All admin routes require a valid JWT + admin role
adminRouter.use(authenticate, requireAdmin);

// ─── Validation schemas ───────────────────────────────────────────────────────

const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const familySearchSchema = paginationSchema.extend({
  search: z.string().optional(),
});

const userSearchSchema = paginationSchema.extend({
  search: z.string().optional(),
});

const auditLogFilterSchema = paginationSchema.extend({
  actorId:      z.string().optional(),
  action:       z.string().optional(),
  resourceType: z.string().optional(),
  familyId:     z.string().optional(),
  from:         z.string().datetime().optional(),
  to:           z.string().datetime().optional(),
});

const suspendSchema = z.object({
  reason: z.string().max(500).optional(),
});

const achievementSchema = z.object({
  name:                  z.string().min(2).max(100),
  description:           z.string().max(500).optional(),
  iconUrl:               z.string().url().optional(),
  category:              z.string().max(50).optional(),
  unlockCriteriaType:    z.string().optional(),
  unlockCriteriaValue:   z.number().int().optional(),
  unlockCriteriaConfig:  z.record(z.unknown()).optional(),
  tier:                  z.enum(['bronze', 'silver', 'gold', 'platinum']).optional(),
  pointsReward:          z.number().int().min(0).default(0),
  xpReward:              z.number().int().min(0).default(0),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Calculate DAU: distinct users who logged in within the last 7 days. */
async function getDau(): Promise<number> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const result = await prisma.user.count({
    where: {
      lastLoginAt: { gte: sevenDaysAgo },
      deletedAt: null,
    },
  });

  return result;
}

// ─── GET /admin/overview ──────────────────────────────────────────────────────

/**
 * Platform health overview.
 * Returns: total families, total users, DAU (last 7 days),
 *          pending approvals across ALL families, new registrations this week.
 */
adminRouter.get('/overview', async (req, res, next) => {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [
      totalFamilies,
      totalUsers,
      dau,
      pendingApprovals,
      newRegistrationsThisWeek,
    ] = await Promise.all([
      prisma.family.count({ where: { deletedAt: null } }),

      prisma.user.count({ where: { deletedAt: null } }),

      getDau(),

      // Pending approvals = completed assignments awaiting parent review
      prisma.taskAssignment.count({
        where: { status: 'completed' },
      }),

      // New family registrations in the last 7 days
      prisma.family.count({
        where: {
          deletedAt: null,
          createdAt: { gte: oneWeekAgo },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        totalFamilies,
        totalUsers,
        dau,
        pendingApprovals,
        newRegistrationsThisWeek,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /admin/families ──────────────────────────────────────────────────────

/**
 * Paginated list of all families with optional text search on familyName.
 * Includes member count and suspension status.
 */
adminRouter.get('/families', validateQuery(familySearchSchema), async (req, res, next) => {
  try {
    const parsed = familySearchSchema.parse(req.query);
    const { page, limit, search } = parsed;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };
    if (search) {
      where.familyName = { contains: search, mode: 'insensitive' };
    }

    const [families, total] = await Promise.all([
      prisma.family.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: { users: true },
          },
          settings: {
            select: { timezone: true, language: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.family.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        families,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /admin/families/:id ──────────────────────────────────────────────────

/**
 * Read-only detail view of a specific family.
 * Returns: family info, all members (sanitised), recent task activity summary.
 */
adminRouter.get('/families/:id', async (req, res, next) => {
  try {
    const family = await prisma.family.findUnique({
      where: { id: req.params.id },
      include: {
        settings: true,
        users: {
          where: { deletedAt: null },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
            isActive: true,
            isPrimaryParent: true,
            lastLoginAt: true,
            createdAt: true,
            childProfile: {
              select: {
                pointsBalance: true,
                level: true,
                currentStreakDays: true,
                totalTasksCompleted: true,
              },
            },
          },
          orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        },
        _count: {
          select: {
            tasks: true,
            rewards: true,
          },
        },
      },
    });

    if (!family) {
      throw new NotFoundError('Family not found');
    }

    // Recent activity: pending approvals + recent completions for this family
    const [pendingApprovals, recentCompletions] = await Promise.all([
      prisma.taskAssignment.count({
        where: {
          status: 'completed',
          task: { familyId: req.params.id },
        },
      }),
      prisma.taskAssignment.count({
        where: {
          status: 'approved',
          task: { familyId: req.params.id },
          approvedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        family,
        activity: { pendingApprovals, recentCompletionsThisWeek: recentCompletions },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /admin/families/:id/suspend ────────────────────────────────────────

/**
 * Suspend a family. Sets isSuspended = true.
 * All logins for users in this family will be blocked by familyIsolation middleware.
 */
adminRouter.patch('/families/:id/suspend', validateBody(suspendSchema), async (req, res, next) => {
  try {
    const family = await prisma.family.findUnique({
      where: { id: req.params.id },
    });

    if (!family) throw new NotFoundError('Family not found');

    await prisma.family.update({
      where: { id: req.params.id },
      data: {
        isSuspended: true,
        suspendedAt: new Date(),
        suspendedBy: req.user!.userId,
      },
    });

    // Audit: admin suspended a family
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'SUSPEND',
      resourceType: 'family',
      resourceId: req.params.id,
      familyId: req.params.id,
      ipAddress: req.ip,
      metadata: { reason: req.body.reason, familyName: family.familyName },
    });

    res.json({
      success: true,
      data: { message: `Family "${family.familyName}" suspended.` },
    });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /admin/families/:id/reactivate ────────────────────────────────────

/**
 * Reactivate a suspended family. Clears isSuspended.
 */
adminRouter.patch('/families/:id/reactivate', async (req, res, next) => {
  try {
    const family = await prisma.family.findUnique({
      where: { id: req.params.id },
    });

    if (!family) throw new NotFoundError('Family not found');

    await prisma.family.update({
      where: { id: req.params.id },
      data: {
        isSuspended: false,
        suspendedAt: null,
        suspendedBy: null,
      },
    });

    // Audit: admin reactivated a family
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'REACTIVATE',
      resourceType: 'family',
      resourceId: req.params.id,
      familyId: req.params.id,
      ipAddress: req.ip,
      metadata: { familyName: family.familyName },
    });

    res.json({
      success: true,
      data: { message: `Family "${family.familyName}" reactivated.` },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /admin/users ─────────────────────────────────────────────────────────

/**
 * Cross-family user search with pagination.
 * Searches firstName, lastName, email, and username.
 */
adminRouter.get('/users', validateQuery(userSearchSchema), async (req, res, next) => {
  try {
    const parsed = userSearchSchema.parse(req.query);
    const { page, limit, search } = parsed;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName:  { contains: search, mode: 'insensitive' } },
        { email:     { contains: search, mode: 'insensitive' } },
        { username:  { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          username: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          familyId: true,
          family: { select: { familyName: true } },
          childProfile: {
            select: { pointsBalance: true, level: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        users,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /admin/users/:id ─────────────────────────────────────────────────────

/**
 * User detail view — cross-family. Includes family context and child profile
 * if the user is a child.
 */
adminRouter.get('/users/:id', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        isPrimaryParent: true,
        lastLoginAt: true,
        createdAt: true,
        familyId: true,
        family: {
          select: {
            familyName: true,
            familyCode: true,
            isSuspended: true,
          },
        },
        childProfile: {
          select: {
            pointsBalance: true,
            totalPointsEarned: true,
            level: true,
            experiencePoints: true,
            totalXpEarned: true,
            currentStreakDays: true,
            longestStreakDays: true,
            totalTasksCompleted: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundError('User not found');

    res.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /admin/users/:id/force-reset ────────────────────────────────────────

/**
 * Force-reset a user's password.
 * For now this marks the user's account so that the next login attempt will
 * require a password reset. In M9 this will also send a reset email.
 *
 * Implementation: sets passwordHash to null (so existing password no longer
 * works) and isActive to true (in case the account was locked). The user
 * must register a new password via the reset flow.
 */
adminRouter.post('/users/:id/force-reset', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true, firstName: true, lastName: true },
    });

    if (!user) throw new NotFoundError('User not found');

    // Nullify the password hash so their current credentials stop working.
    // When M9 email is live, this is also where we'll call EmailService.sendPasswordReset().
    await prisma.user.update({
      where: { id: req.params.id },
      data: {
        passwordHash: null,
        lockedUntil: null,   // Clear any login lock
        isActive: true,
      },
    });

    // Audit: admin force-reset a user's password
    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'FORCE_RESET',
      resourceType: 'user',
      resourceId: req.params.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: { targetEmail: user.email, targetName: `${user.firstName} ${user.lastName}` },
    });

    res.json({
      success: true,
      data: {
        message: `Password reset initiated for ${user.firstName} ${user.lastName}. They must set a new password on next login.`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /admin/achievements ──────────────────────────────────────────────────

/**
 * List all global (system) achievements.
 * Includes unlock count so admin can see how popular each achievement is.
 */
adminRouter.get('/achievements', async (_req, res, next) => {
  try {
    const achievements = await prisma.achievement.findMany({
      include: {
        _count: {
          select: { childAchievements: true },
        },
      },
      orderBy: [{ tier: 'asc' }, { name: 'asc' }],
    });

    res.json({
      success: true,
      data: { achievements },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST /admin/achievements ─────────────────────────────────────────────────

/**
 * Create a new global achievement. isSystemAchievement is always set to true
 * for admin-created achievements so they apply across all families.
 */
adminRouter.post('/achievements', validateBody(achievementSchema), async (req, res, next) => {
  try {
    const achievement = await prisma.achievement.create({
      data: {
        ...req.body,
        isSystemAchievement: true,
      },
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'CREATE',
      resourceType: 'achievement',
      resourceId: achievement.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: { name: achievement.name, tier: achievement.tier },
    });

    res.status(201).json({
      success: true,
      data: { achievement },
    });
  } catch (error) {
    next(error);
  }
});

// ─── PUT /admin/achievements/:id ──────────────────────────────────────────────

/**
 * Edit an existing global achievement.
 */
adminRouter.put('/achievements/:id', validateBody(achievementSchema.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.achievement.findUnique({
      where: { id: req.params.id },
    });

    if (!existing) throw new NotFoundError('Achievement not found');

    const updated = await prisma.achievement.update({
      where: { id: req.params.id },
      data: req.body,
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'UPDATE',
      resourceType: 'achievement',
      resourceId: req.params.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: { changes: req.body },
    });

    res.json({
      success: true,
      data: { achievement: updated },
    });
  } catch (error) {
    next(error);
  }
});

// ─── DELETE /admin/achievements/:id ───────────────────────────────────────────

/**
 * Delete a global achievement. Also removes all ChildAchievement records
 * that reference it (cascade is handled by Prisma onDelete: Cascade).
 */
adminRouter.delete('/achievements/:id', async (req, res, next) => {
  try {
    const existing = await prisma.achievement.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { childAchievements: true } } },
    });

    if (!existing) throw new NotFoundError('Achievement not found');

    await prisma.achievement.delete({
      where: { id: req.params.id },
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'DELETE',
      resourceType: 'achievement',
      resourceId: req.params.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: {
        name: existing.name,
        affectedChildren: existing._count.childAchievements,
      },
    });

    res.json({
      success: true,
      data: {
        message: `Achievement "${existing.name}" deleted. ${existing._count.childAchievements} child records removed.`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /admin/audit-logs ────────────────────────────────────────────────────

/**
 * Paginated audit log viewer with rich filtering.
 * Filters: actorId, action, resourceType, familyId, date range (from/to).
 */
adminRouter.get('/audit-logs', validateQuery(auditLogFilterSchema), async (req, res, next) => {
  try {
    const {
      page, limit, actorId, action, resourceType, familyId, from, to,
    } = auditLogFilterSchema.parse(req.query);

    const skip = (page - 1) * limit;

    const where: any = {};
    if (actorId)      where.actorId      = actorId;
    if (action)       where.action       = action;
    if (resourceType) where.resourceType = resourceType;
    if (familyId)     where.familyId     = familyId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      success: true,
      data: {
        logs,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /admin/audit-logs/export ─────────────────────────────────────────────

/**
 * CSV export of the audit log. Applies the same filters as the paginated
 * viewer but returns all matching rows (no pagination).
 *
 * The response uses Content-Disposition: attachment so the browser triggers
 * a file download. The admin frontend calls this via window.location.href
 * with the auth token in the Authorization header (handled by the api.ts
 * exportAuditLogs() helper which builds the URL).
 *
 * Note: For very large datasets consider streaming this response. For M8
 * the full-fetch approach is acceptable since audit logs grow slowly.
 */
adminRouter.get('/audit-logs/export', validateQuery(auditLogFilterSchema.omit({ page: true, limit: true })), async (req, res, next) => {
  try {
    const { actorId, action, resourceType, familyId, from, to } = auditLogFilterSchema.omit({ page: true, limit: true }).parse(req.query);

    const where: any = {};
    if (actorId)      where.actorId      = actorId;
    if (action)       where.action       = action;
    if (resourceType) where.resourceType = resourceType;
    if (familyId)     where.familyId     = familyId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to)   where.createdAt.lte = new Date(to);
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Build CSV manually (no external library needed for this simple schema)
    const headers = ['id', 'actorId', 'action', 'resourceType', 'resourceId', 'familyId', 'ipAddress', 'createdAt', 'metadata'];
    const rows = logs.map((log) => [
      log.id,
      log.actorId ?? '',
      log.action,
      log.resourceType,
      log.resourceId,
      log.familyId ?? '',
      log.ipAddress ?? '',
      log.createdAt.toISOString(),
      // Stringify metadata and escape double-quotes for CSV
      log.metadata ? `"${JSON.stringify(log.metadata).replace(/"/g, '""')}"` : '',
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const filename = `taskbuddy-audit-log-${new Date().toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});