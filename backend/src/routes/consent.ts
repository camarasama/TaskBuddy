/**
 * routes/consent.ts — COPPA verifiable parental consent (growth roadmap §3.2).
 * Mounted at /api/v1/consent.
 *
 *   GET  /consent/status   - parent-only; drives the UI
 *   POST /consent/request  - parent-only; sends (or re-sends) the verification email
 *   POST /consent/verify   - PUBLIC; the emailed link, proof is possession of the token
 *
 * /verify is deliberately public. The parent following it from their inbox may not have a session on
 * that device — requiring one would strand exactly the people the flow depends on. Possession of a
 * 32-byte single-use token IS the proof, which is why the lookup is by token hash and no family id
 * appears in the URL to tamper with.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireParent, familyIsolation } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { ConsentService } from '../services/ConsentService';
import { AuditService } from '../services/AuditService';
import { CONSENT_VERSIONS } from '@taskbuddy/shared';

export const consentRouter = Router();

const verifySchema = z.object({ token: z.string().min(16).max(256) });

// ─── POST /consent/verify (PUBLIC — must be declared before the auth middleware) ──

consentRouter.post('/verify', validateBody(verifySchema), async (req, res, next) => {
  try {
    const { token } = verifySchema.parse(req.body);
    const { familyId } = await ConsentService.verifyConsent({
      rawToken: token,
      ipAddress: req.ip,
    });

    // COPPA expects a durable record of who consented and when; the AuditLog is that record, and it
    // now carries the verification method rather than only the document versions.
    await AuditService.logAction({
      actorId: null,
      action: 'CONSENT',
      resourceType: 'family',
      resourceId: familyId,
      familyId,
      ipAddress: req.ip,
      metadata: {
        context: 'coppa_verified',
        method: ConsentService.ACTIVE_METHOD_ID,
        tosVersion: CONSENT_VERSIONS.tos,
        privacyVersion: CONSENT_VERSIONS.privacy,
      },
    });

    res.json({ success: true, data: { status: 'verified' } });
  } catch (error) {
    next(error);
  }
});

// ─── Everything below requires a parent session ───────────────────────────────

consentRouter.use(authenticate, familyIsolation, requireParent);

consentRouter.get('/status', async (req, res, next) => {
  try {
    const status = await ConsentService.getStatus(req.familyId!);
    res.json({
      success: true,
      data: { ...status, activeMethod: ConsentService.ACTIVE_METHOD_ID },
    });
  } catch (error) {
    next(error);
  }
});

consentRouter.post('/request', async (req, res, next) => {
  try {
    const result = await ConsentService.requestConsent({
      familyId: req.familyId!,
      parentId: req.user!.userId,
    });
    res.status(202).json({
      success: true,
      data: { ...result, message: 'Check your email to confirm you are the parent.' },
    });
  } catch (error) {
    next(error);
  }
});
