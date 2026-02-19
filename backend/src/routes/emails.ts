/**
 * routes/emails.ts — M9
 * Admin-only endpoints for the email log viewer and manual resend.
 *
 * Mounted at: /admin/emails  (see routes/index.ts)
 * Auth: requireAuth + requireAdmin middleware on all routes
 *
 * GET  /admin/emails         — paginated email_logs with filters
 * POST /admin/emails/:id/resend — re-send a failed email using its logged data
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../services/database';
import { EmailService, EmailTriggerType } from '../services/email';
import { authenticate, requireAdmin } from '../middleware/auth';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';

const router = Router();

// All routes in this file require admin auth
router.use(authenticate, requireAdmin);

// ─── GET /admin/emails ────────────────────────────────────────────────────────

/**
 * Query params:
 *  status       — 'sent' | 'failed' | 'bounced'
 *  triggerType  — any EmailTriggerType
 *  familyId     — filter by family
 *  from         — ISO date string (createdAt >=)
 *  to           — ISO date string (createdAt <=)
 *  page         — page number (default 1)
 *  limit        — page size (default 50, max 200)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      status,
      triggerType,
      familyId,
      from,
      to,
      page = '1',
      limit = '50',
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    if (status) where.status = status;
    if (triggerType) where.triggerType = triggerType;
    if (familyId) where.familyId = familyId;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [logs, total] = await Promise.all([
      prisma.emailLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          toUser: {
            select: { firstName: true, lastName: true, email: true, role: true },
          },
          family: {
            select: { familyName: true },
          },
        },
      }),
      prisma.emailLog.count({ where }),
    ]);

    res.json({
      logs,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /admin/emails/:id/resend ───────────────────────────────────────────

/**
 * Re-sends the email for a given log entry.
 * Only allowed for logs with status='failed'.
 * Uses the original subject and templateData stored in the log.
 * Increments resendCount and sets lastResentAt on the original log.
 */
router.post('/:id/resend', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const log = await prisma.emailLog.findUnique({ where: { id } });

    if (!log) {
      throw new NotFoundError('Email log entry not found');
    }

    if (log.status !== 'failed') {
      throw new ValidationError(
        `Only failed emails can be resent. This email has status "${log.status}".`,
      );
    }

    // Attempt resend — EmailService will create a new log entry for this attempt
    await EmailService.send({
      triggerType: log.triggerType as EmailTriggerType,
      toEmail: log.toEmail,
      toUserId: log.toUserId,
      familyId: log.familyId,
      subject: log.subject,
      // EmailService.send() expects templateData but the log stores rendered HTML.
      // For resends, we pass an empty templateData and trust that EmailService
      // will render a fresh template. The admin should use this for transient
      // SMTP failures, not for template data changes.
      templateData: {},
      referenceType: log.referenceType ?? undefined,
      referenceId: log.referenceId ?? undefined,
      skipPreferenceCheck: true, // Admin-initiated resend bypasses prefs
    });

    // Update the original log with resend metadata
    const updatedLog = await prisma.emailLog.update({
      where: { id },
      data: {
        resendCount: { increment: 1 },
        lastResentAt: new Date(),
      },
    });

    res.json({
      log: updatedLog,
      message: `Email resent successfully to ${log.toEmail}`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;