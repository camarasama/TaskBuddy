/**
 * routes/adminTesters.ts — the closed-test roster.
 *
 * Mounted at `/api/v1/admin/testers`. Admin-only, like everything else under `/admin`.
 *
 * Exists because Play's production-access gate needs **12 testers opted in for 14 consecutive days**,
 * and the failure mode is not technical: people agree to help, never complete the opt-in, and nobody
 * notices until the clock has not started. This turns that into something visible.
 *
 * ## A tester is not a User, deliberately
 *
 * They are a person being tracked through a recruitment process. They may never sign up, may sign up
 * weeks later, or may sign up with a different address. Creating `users` rows for them would mean
 * accounts nobody consented to, sitting in the table authentication trusts. So the roster is its own
 * table and the link to a real account is resolved by **email**, lazily, on every read.
 *
 * ## What "tracking" means here, and what it does not
 *
 * For a tester who has signed up, the activity view reads `users.lastLoginAt` and their `AuditLog`
 * rows. That is the same trail the audit-log screen already exposes to admins — this adds no new
 * collection, it just scopes an existing one to a named person.
 *
 * ⚠️ It is still monitoring of identifiable adults who are not customers, and PRIVACY.md does not
 * describe it. The invite email tells each tester plainly that their sign-ins and actions are
 * visible; that is the minimum, and the policy still needs a paragraph.
 */

import { Router } from 'express';
import { z } from 'zod';

import { prisma } from '../services/database';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validate';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';
import { EmailService } from '../services/email';
import { AuditService } from '../services/AuditService';
import { config } from '../config';

export const adminTestersRouter = Router();

adminTestersRouter.use(authenticate, requireAdmin);

const idParam = z.object({ id: z.string().uuid() });

const testerSchema = z.object({
  firstName: z.string().min(1).max(50),
  lastName: z.string().min(1).max(50),
  email: z.string().email(),
  /**
   * Optional, and nothing in this stack sends SMS. Collected only because the owner wants it on the
   * roster; kept optional so a complete roster does not require a number that has no use.
   */
  phone: z.string().max(30).optional(),
  status: z.enum(['invited', 'opted_in', 'active', 'declined']).optional(),
  notes: z.string().max(1000).optional(),
});

const updateSchema = testerSchema.partial();

/** How far back the activity view looks. Longer than the 14-day clock, so the whole test is visible. */
const ACTIVITY_WINDOW_DAYS = 30;

/**
 * Attach account and activity to a roster row.
 *
 * The join is by email and happens on read rather than being trusted from `userId`, because a tester
 * can sign up at any moment and nothing tells this table when they do. When a match is found the
 * `userId` is written back, so the link survives an email change on the account afterwards.
 */
async function withActivity(tester: {
  id: string;
  email: string;
  userId: string | null;
}): Promise<{
  hasAccount: boolean;
  userId: string | null;
  signedUpAt: Date | null;
  lastLoginAt: Date | null;
  actionCount: number;
  recentActions: { action: string; resourceType: string; createdAt: Date }[];
}> {
  const user =
    (tester.userId
      ? await prisma.user.findUnique({
          where: { id: tester.userId },
          select: { id: true, createdAt: true, lastLoginAt: true },
        })
      : null) ??
    (await prisma.user.findFirst({
      where: { email: tester.email, deletedAt: null },
      select: { id: true, createdAt: true, lastLoginAt: true },
    }));

  if (!user) {
    return {
      hasAccount: false,
      userId: null,
      signedUpAt: null,
      lastLoginAt: null,
      actionCount: 0,
      recentActions: [],
    };
  }

  // Cache the link once found. Cheap, idempotent, and it keeps working if they later change the
  // email on their account — at which point the lookup above would stop matching.
  if (tester.userId !== user.id) {
    await prisma.tester.update({ where: { id: tester.id }, data: { userId: user.id } });
  }

  const since = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 86_400_000);
  const [actionCount, recentActions] = await Promise.all([
    prisma.auditLog.count({ where: { actorId: user.id, createdAt: { gte: since } } }),
    prisma.auditLog.findMany({
      where: { actorId: user.id, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { action: true, resourceType: true, createdAt: true },
    }),
  ]);

  return {
    hasAccount: true,
    userId: user.id,
    signedUpAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    actionCount,
    recentActions,
  };
}

// ─── GET / — the roster, with live activity ──────────────────────────────────

adminTestersRouter.get('/', async (req, res, next) => {
  try {
    const testers = await prisma.tester.findMany({ orderBy: { createdAt: 'asc' } });
    const rows = await Promise.all(
      testers.map(async (tester) => ({ ...tester, activity: await withActivity(tester) })),
    );

    /**
     * The number that actually matters. Play counts testers **opted in**, not invited — so this
     * deliberately counts the `active` status rather than the roster length, and states the shortfall
     * against 12 rather than leaving it to be worked out.
     */
    const optedIn = rows.filter((r) => r.status === 'active').length;

    res.json({
      success: true,
      data: {
        testers: rows,
        summary: {
          total: rows.length,
          optedIn,
          required: 12,
          shortfall: Math.max(0, 12 - optedIn),
          withAccount: rows.filter((r) => r.activity.hasAccount).length,
          neverInvited: rows.filter((r) => r.invitedAt === null).length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── POST / — add someone to the roster ──────────────────────────────────────

adminTestersRouter.post('/', validateBody(testerSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof testerSchema>;
    const email = body.email.trim().toLowerCase();

    const clash = await prisma.tester.findUnique({ where: { email } });
    // A duplicate is almost always the same person being added twice, so it is worth an explicit
    // message rather than a raw unique-constraint 500.
    if (clash) throw new ValidationError('That email is already on the roster.');

    const tester = await prisma.tester.create({
      data: { ...body, email, status: body.status ?? 'invited' },
    });

    res.status(201).json({ success: true, data: { tester } });
  } catch (error) {
    next(error);
  }
});

// ─── PATCH /:id ──────────────────────────────────────────────────────────────

adminTestersRouter.patch(
  '/:id',
  validateParams(idParam),
  validateBody(updateSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof updateSchema>;
      const existing = await prisma.tester.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new NotFoundError('Tester not found');

      const tester = await prisma.tester.update({
        where: { id: req.params.id },
        data: { ...body, ...(body.email ? { email: body.email.trim().toLowerCase() } : {}) },
      });

      res.json({ success: true, data: { tester } });
    } catch (error) {
      next(error);
    }
  },
);

// ─── DELETE /:id ─────────────────────────────────────────────────────────────

adminTestersRouter.delete('/:id', validateParams(idParam), async (req, res, next) => {
  try {
    const existing = await prisma.tester.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new NotFoundError('Tester not found');

    await prisma.tester.delete({ where: { id: req.params.id } });
    res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    next(error);
  }
});

// ─── Emails ──────────────────────────────────────────────────────────────────

/**
 * The Play opt-in URL.
 *
 * Configured rather than derived: it is issued by Play Console when the closed track is created and
 * has no relationship to any URL this app knows. Absent, the endpoints refuse rather than sending an
 * email with a broken or guessed link — a wrong link in a one-shot invitation is worse than no email.
 */
function optInUrl(): string {
  const url = process.env.PLAY_OPT_IN_URL;
  if (!url) {
    throw new ValidationError(
      'PLAY_OPT_IN_URL is not set. Create the closed track in Play Console, then put its opt-in link in the backend environment before sending invitations.',
    );
  }
  return url;
}

const APP_NAME = process.env.PLAY_APP_NAME ?? 'TaskBuddy';

adminTestersRouter.post('/:id/invite', validateParams(idParam), async (req, res, next) => {
  try {
    const tester = await prisma.tester.findUnique({ where: { id: req.params.id } });
    if (!tester) throw new NotFoundError('Tester not found');

    await EmailService.send({
      triggerType: 'tester_invite',
      toEmail: tester.email,
      // No account and no family: these people are not users, and may never be.
      toUserId: null,
      familyId: null,
      subject: `Would you help me test ${APP_NAME}?`,
      templateData: { firstName: tester.firstName, optInUrl: optInUrl(), appName: APP_NAME },
      // They have no family record, so there are no notification preferences to consult.
      skipPreferenceCheck: true,
    });

    const updated = await prisma.tester.update({
      where: { id: tester.id },
      // Status only advances from `invited`; an explicit `declined` or `active` set by the admin is
      // a fact about the conversation and must not be overwritten by sending an email.
      data: { invitedAt: new Date(), ...(tester.status === 'invited' ? {} : {}) },
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'TESTER_INVITE_SENT',
      resourceType: 'tester',
      resourceId: tester.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: { email: tester.email },
    });

    res.json({ success: true, data: { tester: updated } });
  } catch (error) {
    next(error);
  }
});

adminTestersRouter.post('/:id/remind', validateParams(idParam), async (req, res, next) => {
  try {
    const tester = await prisma.tester.findUnique({ where: { id: req.params.id } });
    if (!tester) throw new NotFoundError('Tester not found');

    // Which reminder to send depends on where they actually got stuck — someone who never opted in
    // needs the link again; someone who did needs to know that *opening the app* is what counts.
    const activity = await withActivity(tester);

    await EmailService.send({
      triggerType: 'tester_reminder',
      toEmail: tester.email,
      toUserId: activity.userId,
      familyId: null,
      subject: activity.hasAccount
        ? `A quick nudge about ${APP_NAME}`
        : `One step left to join the ${APP_NAME} test`,
      templateData: {
        firstName: tester.firstName,
        optInUrl: optInUrl(),
        appName: APP_NAME,
        hasSignedIn: activity.hasAccount,
        daysRemaining: null,
      },
      skipPreferenceCheck: true,
    });

    const updated = await prisma.tester.update({
      where: { id: tester.id },
      data: { lastRemindedAt: new Date() },
    });

    await AuditService.logAction({
      actorId: req.user!.userId,
      action: 'TESTER_REMINDER_SENT',
      resourceType: 'tester',
      resourceId: tester.id,
      familyId: null,
      ipAddress: req.ip,
      metadata: { email: tester.email, hasSignedIn: activity.hasAccount },
    });

    res.json({ success: true, data: { tester: updated } });
  } catch (error) {
    next(error);
  }
});
