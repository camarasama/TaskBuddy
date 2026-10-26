/**
 * routes/emailPreferences.ts - public "stop tips and reminders" endpoint (2026-10-26).
 * Mounted at /api/v1/email. PUBLIC by necessity: mail clients cannot authenticate.
 *
 *   POST /email/unsubscribe?u=<userId>&t=<sig>
 *
 * Serves both the RFC 8058 one-click header (the mail client POSTs `List-Unsubscribe=One-Click`
 * to the header URL) and the web /unsubscribe page, which POSTs the same pair. There is no GET that
 * changes anything: link scanners and previewers fetch every URL in an email, and a GET that
 * unsubscribed would opt people out without them ever clicking.
 *
 * The token is an HMAC of the user id, so ids cannot be enumerated. A bad token and an unknown user
 * get the same 400, and a repeat unsubscribe is a quiet success.
 */

import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { ReengagementService, verifyUnsubscribe } from '../services/ReengagementService';
import { AuditService } from '../services/AuditService';

export const emailPreferencesRouter = Router();

const params = z.object({
  u: z.string().uuid(),
  t: z.string().regex(/^[0-9a-f]{32}$/),
});

emailPreferencesRouter.post('/unsubscribe', async (req, res, next) => {
  try {
    const parsed = params.safeParse({
      u: req.query.u ?? req.body?.u,
      t: req.query.t ?? req.body?.t,
    });
    if (!parsed.success || !verifyUnsubscribe(parsed.data.u, parsed.data.t)) {
      throw new AppError(400, 'INVALID_LINK', 'This unsubscribe link is not valid.');
    }
    const changed = await ReengagementService.optOut(parsed.data.u);
    if (changed) {
      await AuditService.logAction({
        actorId: parsed.data.u,
        action: 'UPDATE',
        resourceType: 'user',
        resourceId: parsed.data.u,
        ipAddress: req.ip,
        metadata: { reengagementOptOut: true },
      });
    }
    res.json({ success: true, data: { unsubscribed: true } });
  } catch (error) {
    next(error);
  }
});
