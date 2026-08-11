/**
 * The COPPA gate on POST /families/me/children, and specifically the email it now sends itself.
 *
 * Registration never requests consent. Before this, the gate's 403 told a parent to check an inbox
 * that no email had ever been sent to, and pointed them at the website to fix it — useless on a
 * mobile-only install. The gate now sends the email on first refusal.
 *
 * Two properties are worth defending, and they pull in opposite directions:
 *
 *  - **It sends when there is nothing live to find.** Otherwise the instruction is a lie.
 *  - **It does NOT send when a request is already pending.** `requestConsent` mints a fresh token
 *    and invalidates the old one, so re-sending on every submit would race the parent: the link in
 *    the email they are reading stops working because they pressed the button again. It would also
 *    be an unthrottled outbound email on a route any logged-in parent can hit.
 *
 * The gate itself must keep refusing either way. The email is a courtesy, not the decision.
 */

jest.mock('../src/services/ConsentService', () => ({
  ConsentService: {
    hasVerifiedConsent: jest.fn(),
    getStatus: jest.fn(),
    requestConsent: jest.fn(),
  },
}));

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
    family: { findUnique: jest.fn() },
  },
}));

jest.mock('../src/services/auth', () => ({
  authService: { addChild: jest.fn() },
}));

jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn() },
}));

jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn(), sendToFamilyParents: jest.fn() },
}));

jest.mock('../src/services/invite', () => ({ inviteService: {} }));
jest.mock('../src/services/ReferralService', () => ({ getReferralSummary: jest.fn() }));
jest.mock('../src/services/storage', () => ({ isOwnStorageUrl: jest.fn(() => true) }));
jest.mock('./../src/routes/notifications', () => ({
  createNotification: jest.fn(),
  notificationsRouter: {},
}));

/** Both guards have their own tests; what is under test here is the handler behind them. */
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'parent-1', role: 'parent' };
    next();
  },
  familyIsolation: (req: any, _res: any, next: any) => {
    req.familyId = 'fam-1';
    next();
  },
  requireParent: (_req: any, _res: any, next: any) => next(),
  requireChild: (_req: any, _res: any, next: any) => next(),
}));

import request from 'supertest';
import express from 'express';

import { ConsentService } from '../src/services/ConsentService';
import { authService } from '../src/services/auth';
import { EmailService } from '../src/services/email';

const consent = ConsentService as unknown as {
  hasVerifiedConsent: jest.Mock;
  getStatus: jest.Mock;
  requestConsent: jest.Mock;
};

function buildApp() {
  const app = express();
  app.use(express.json());
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { familyRouter } = require('../src/routes/family');
  app.use('/families', familyRouter);
  // The REAL error handler, not a stand-in. `validateBody` passes the raw ZodError through and only
  // the real handler maps it to a 400 — a hand-rolled `err.statusCode ?? 500` reports every
  // validation failure as a 500, which is exactly how a passing test can describe behaviour the app
  // does not have.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { errorHandler } = require('../src/middleware/errorHandler');
  app.use(errorHandler);
  return app;
}

/** A body that passes addChildSchema, so validation never masks the gate's behaviour. */
function validChild() {
  const twelveYearsAgo = new Date();
  twelveYearsAgo.setFullYear(twelveYearsAgo.getFullYear() - 12);
  return {
    firstName: 'Sam',
    lastName: 'Carter',
    dateOfBirth: twelveYearsAgo.toISOString().slice(0, 10),
    username: 'sam_c',
    pin: '1234',
    // Present by default so the gate tests fail on the gate, not on validation. The tick's own
    // behaviour is asserted separately below.
    consentFormAccepted: true as const,
  };
}

const addChild = () => request(buildApp()).post('/families/me/children').send(validChild());

beforeEach(() => {
  jest.clearAllMocks();
  consent.requestConsent.mockResolvedValue({ status: 'pending', method: 'email_plus' });
  // The real method is async and the route calls `.catch()` on it. A bare jest.fn() returns
  // undefined, so the route would throw a TypeError on the SUCCESS path — a mock that does not
  // match the shape of what it replaces.
  (EmailService.sendToFamilyParents as jest.Mock).mockResolvedValue(undefined);
});

describe('the gate still refuses, whatever the email does', () => {
  it('refuses with CONSENT_REQUIRED when consent is not verified', async () => {
    consent.hasVerifiedConsent.mockResolvedValue(false);
    consent.getStatus.mockResolvedValue({ status: 'none' });

    const res = await addChild();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    // The whole point of the gate: no child data is written.
    expect(authService.addChild).not.toHaveBeenCalled();
  });

  it('lets the child through once consent is verified, and sends nothing', async () => {
    consent.hasVerifiedConsent.mockResolvedValue(true);
    (authService.addChild as jest.Mock).mockResolvedValue({ user: { id: 'child-1' } });

    const res = await addChild();

    expect(res.status).toBeLessThan(400);
    expect(authService.addChild).toHaveBeenCalled();
    expect(consent.requestConsent).not.toHaveBeenCalled();
  });
});

describe('the email the gate sends itself', () => {
  beforeEach(() => consent.hasVerifiedConsent.mockResolvedValue(false));

  it('sends when nothing has been requested, so "check your email" is true', async () => {
    consent.getStatus.mockResolvedValue({ status: 'none' });

    const res = await addChild();

    expect(consent.requestConsent).toHaveBeenCalledWith({
      familyId: 'fam-1',
      parentId: 'parent-1',
    });
    expect(res.body.error.message).toMatch(/emailed you a link/i);
  });

  // An expired pending request needs no case of its own here: `getStatus` already reports it as
  // 'none' (covered in parental-consent.test.ts), so it takes the branch above.

  it('does NOT re-send while a request is pending, which would invalidate the live link', async () => {
    consent.getStatus.mockResolvedValue({ status: 'pending' });

    const res = await addChild();

    expect(consent.requestConsent).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
    // Different wording, because telling them we just emailed would be false.
    expect(res.body.error.message).not.toMatch(/emailed you a link/i);
  });

  it('still refuses with CONSENT_REQUIRED when the send itself fails', async () => {
    consent.getStatus.mockResolvedValue({ status: 'none' });
    consent.requestConsent.mockRejectedValue(new Error('SMTP down'));

    const res = await addChild();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONSENT_REQUIRED');
    expect(authService.addChild).not.toHaveBeenCalled();
  });
});

describe('the consent tick on the create-child form', () => {
  beforeEach(() => {
    consent.hasVerifiedConsent.mockResolvedValue(true);
    (authService.addChild as jest.Mock).mockResolvedValue({ user: { id: 'child-1' } });
  });

  it('refuses and writes no child when the tick is missing', async () => {
    const res = await request(buildApp())
      .post('/families/me/children')
      .send({ ...validChild(), consentFormAccepted: undefined });

    expect(res.status).toBe(400);
    expect(authService.addChild).not.toHaveBeenCalled();
  });

  it('refuses when the tick is present but false, which is the whole point of z.literal(true)', async () => {
    // A plain z.boolean() would accept this and record a consent nobody gave.
    const res = await request(buildApp())
      .post('/families/me/children')
      .send({ ...validChild(), consentFormAccepted: false });

    expect(res.status).toBe(400);
    expect(authService.addChild).not.toHaveBeenCalled();
  });

  it('emails EVERY parent on the account, with the exact subject the brief specifies', async () => {
    // Fan-out is the substance: a co-parent who did not press the button still learns that consent
    // was recorded in their family's name. The subject is fixed verbatim, lowercase 'b' included.
    await request(buildApp()).post('/families/me/children').send(validChild());

    expect(EmailService.sendToFamilyParents).toHaveBeenCalledWith(
      expect.objectContaining({
        familyId: 'fam-1',
        triggerType: 'parental_consent_recorded',
      }),
    );

    const call = (EmailService.sendToFamilyParents as jest.Mock).mock.calls[0][0];
    expect(call.subjectBuilder()).toBe('Parental Consent Recorded - Taskbuddy');
  });
});
