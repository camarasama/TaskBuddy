/**
 * routes/track.ts — email open tracking for the weekly digest (growth roadmap §1).
 * Mounted at /api/v1/track. PUBLIC by necessity: email clients cannot authenticate.
 *
 * The roadmap lists "weekly digest open rate > 45%" as a retention KPI, which needs an open event.
 *
 * Because it is public, the URL is HMAC-signed. Without that, anyone could enumerate family ids and
 * fabricate DIGEST_OPENED events, quietly poisoning the one metric this exists to produce. The
 * signature binds familyId + week, so a captured pixel URL cannot be replayed against a different
 * family or a different week either.
 *
 * Scope note: this tracks a PARENT opening their own summary email. No child session, no child
 * device, and no third-party pixel is involved — the request goes to our own server. The recorded
 * event carries ids only, and AnalyticsService strips anything else.
 */

import crypto from 'crypto';
import { Router } from 'express';
import { config } from '../config';
import { AnalyticsService } from '../services/AnalyticsService';

export const trackRouter = Router();

/**
 * A 1x1 transparent GIF. Returned for every request regardless of outcome — an invalid signature
 * must look identical to a valid one, or the endpoint becomes an oracle for guessing family ids.
 */
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

/** Stable key for the week a digest covers, so a signature cannot be replayed next week. */
export function weekKey(date: Date): string {
  const monday = new Date(date);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function signDigestOpen(familyId: string, week: string): string {
  return crypto
    .createHmac('sha256', config.jwt.secret)
    .update(`digest-open:${familyId}:${week}`)
    .digest('hex')
    .slice(0, 32);
}

/** Absolute pixel URL for the email, or undefined when no API base is configured. */
export function buildTrackingPixelUrl(familyId: string, now: Date): string | undefined {
  const apiUrl = process.env.API_URL || config.apiUrl;
  if (!apiUrl) return undefined;
  const week = weekKey(now);
  return `${apiUrl}/api/v1/track/digest/${familyId}/${week}/${signDigestOpen(familyId, week)}.gif`;
}

// ─── GET /track/digest/:familyId/:week/:sig.gif ───────────────────────────────

trackRouter.get('/digest/:familyId/:week/:sig', (req, res) => {
  const { familyId, week } = req.params;
  const sig = req.params.sig.replace(/\.gif$/, '');

  const expected = signDigestOpen(familyId, week);

  // timingSafeEqual throws on length mismatch, so guard first.
  const valid =
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));

  if (valid) {
    // Fire-and-forget; AnalyticsService swallows its own failures.
    void AnalyticsService.record({
      eventType: 'DIGEST_OPENED',
      familyId,
      actorRole: 'parent',
      payload: { week },
    });
  }

  // Same response either way — never reveal whether the signature checked out.
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': String(PIXEL.length),
    // Caching an open pixel would suppress every subsequent open.
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
  });
  res.status(200).end(PIXEL);
});
