/**
 * U4a — COPPA verifiable parental consent (growth roadmap §3.2).
 *
 * What existed before was NOT this: `AuditLog` rows with `action: 'CONSENT'` record that terms were
 * accepted (a GDPR-K trail). COPPA additionally requires a verification METHOD and requires child
 * data collection to be BLOCKED until verification completes.
 *
 * The properties below are the ones a compliance failure would hinge on, so each is named:
 *  - an absent record must read as NOT consented (fail closed);
 *  - the token is single-use and expires;
 *  - lookup is by token hash, so no family id is exposed to tamper with;
 *  - the "plus" step failing must not un-verify a consent legitimately given.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    parentalConsent: { findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    user: { findFirst: jest.fn(), findUnique: jest.fn() },
  },
}));

const mockSend = jest.fn();
jest.mock('../src/services/email', () => ({
  EmailService: { send: (...args: unknown[]) => mockSend(...args) },
}));

import crypto from 'crypto';
import {
  ACTIVE_METHOD_ID,
  CONSENT_TOKEN_TTL_MS,
  ConsentService,
  getMethod,
} from '../src/services/ConsentService';
import { prisma } from '../src/services/database';

const p = prisma as unknown as {
  parentalConsent: { findUnique: jest.Mock; findFirst: jest.Mock; upsert: jest.Mock; update: jest.Mock };
  user: { findFirst: jest.Mock; findUnique: jest.Mock };
};

const FAMILY = 'fam-1';
const PARENT = 'parent-1';

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockResolvedValue(undefined);
  p.parentalConsent.upsert.mockResolvedValue({});
  p.parentalConsent.update.mockResolvedValue({});
  p.user.findFirst.mockResolvedValue({ email: 'parent@example.com', firstName: 'Sam' });
  p.user.findUnique.mockResolvedValue({ email: 'parent@example.com', firstName: 'Sam' });
});

// ─── The gate ─────────────────────────────────────────────────────────────────

describe('hasVerifiedConsent — the child-creation gate', () => {
  it('is FALSE when no record exists — fails closed', async () => {
    // The single most important property: a missing row must never permit collection.
    p.parentalConsent.findUnique.mockResolvedValue(null);
    expect(await ConsentService.hasVerifiedConsent(FAMILY)).toBe(false);
  });

  it('is FALSE while consent is only pending', async () => {
    p.parentalConsent.findUnique.mockResolvedValue({ status: 'pending' });
    expect(await ConsentService.hasVerifiedConsent(FAMILY)).toBe(false);
  });

  it('is FALSE once consent is revoked', async () => {
    p.parentalConsent.findUnique.mockResolvedValue({ status: 'revoked' });
    expect(await ConsentService.hasVerifiedConsent(FAMILY)).toBe(false);
  });

  it('is TRUE only for a verified record', async () => {
    p.parentalConsent.findUnique.mockResolvedValue({ status: 'verified' });
    expect(await ConsentService.hasVerifiedConsent(FAMILY)).toBe(true);
  });
});

// ─── Requesting ───────────────────────────────────────────────────────────────

describe('requestConsent', () => {
  it('stores only a HASH of the token, never the token itself', async () => {
    p.parentalConsent.findUnique.mockResolvedValue(null);
    await ConsentService.requestConsent({ familyId: FAMILY, parentId: PARENT });

    const created = p.parentalConsent.upsert.mock.calls[0][0].create;
    const emailed = mockSend.mock.calls[0][0].templateData.confirmUrl as string;
    const rawToken = new URL(emailed).searchParams.get('token')!;

    expect(created.tokenHash).toBe(crypto.createHash('sha256').update(rawToken).digest('hex'));
    expect(created.tokenHash).not.toBe(rawToken);
  });

  it('sets an expiry so an abandoned request cannot sit pending forever', async () => {
    p.parentalConsent.findUnique.mockResolvedValue(null);
    const before = Date.now();
    await ConsentService.requestConsent({ familyId: FAMILY, parentId: PARENT });

    const expiresAt = p.parentalConsent.upsert.mock.calls[0][0].create.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + CONSENT_TOKEN_TTL_MS - 5000);
  });

  it('records the method and the document versions', async () => {
    p.parentalConsent.findUnique.mockResolvedValue(null);
    await ConsentService.requestConsent({ familyId: FAMILY, parentId: PARENT });

    const created = p.parentalConsent.upsert.mock.calls[0][0].create;
    expect(created.method).toBe(ACTIVE_METHOD_ID);
    expect(created.tosVersion).toBeTruthy();
    expect(created.privacyVersion).toBeTruthy();
  });

  it('re-sends and issues a FRESH token when asked again', async () => {
    // Someone who lost the email will click again; the old token must not remain usable.
    p.parentalConsent.findUnique.mockResolvedValue({ status: 'pending' });
    await ConsentService.requestConsent({ familyId: FAMILY, parentId: PARENT });
    const update = p.parentalConsent.upsert.mock.calls[0][0].update;
    expect(update.status).toBe('pending');
    expect(update.tokenHash).toBeTruthy();
    expect(update.verifiedAt).toBeNull();
  });

  it('refuses to re-request once verified — re-consent should be deliberate', async () => {
    p.parentalConsent.findUnique.mockResolvedValue({ status: 'verified' });
    await expect(
      ConsentService.requestConsent({ familyId: FAMILY, parentId: PARENT }),
    ).rejects.toThrow(/already been verified/i);
  });

  it('bypasses the notification-preference check — this email IS the verification', async () => {
    p.parentalConsent.findUnique.mockResolvedValue(null);
    await ConsentService.requestConsent({ familyId: FAMILY, parentId: PARENT });
    expect(mockSend.mock.calls[0][0].skipPreferenceCheck).toBe(true);
  });

  it('404s when the parent has no email to send to', async () => {
    p.parentalConsent.findUnique.mockResolvedValue(null);
    p.user.findFirst.mockResolvedValue({ email: null, firstName: 'Sam' });
    await expect(
      ConsentService.requestConsent({ familyId: FAMILY, parentId: PARENT }),
    ).rejects.toThrow(/not found/i);
  });
});

// ─── Verifying ────────────────────────────────────────────────────────────────

describe('verifyConsent', () => {
  const RAW = 'a'.repeat(64);
  const HASH = crypto.createHash('sha256').update(RAW).digest('hex');

  it('looks the record up by token hash, so no family id is exposed to tamper with', async () => {
    p.parentalConsent.findFirst.mockResolvedValue({
      id: 'c1', familyId: FAMILY, parentId: PARENT, status: 'pending', method: ACTIVE_METHOD_ID, expiresAt: null,
    });
    await ConsentService.verifyConsent({ rawToken: RAW });
    expect(p.parentalConsent.findFirst).toHaveBeenCalledWith({ where: { tokenHash: HASH } });
  });

  it('marks it verified and records the IP', async () => {
    p.parentalConsent.findFirst.mockResolvedValue({
      id: 'c1', familyId: FAMILY, parentId: PARENT, status: 'pending', method: ACTIVE_METHOD_ID, expiresAt: null,
    });
    await ConsentService.verifyConsent({ rawToken: RAW, ipAddress: '203.0.113.7' });

    const data = p.parentalConsent.update.mock.calls[0][0].data;
    expect(data.status).toBe('verified');
    expect(data.ipAddress).toBe('203.0.113.7');
    expect(data.verifiedAt).toBeInstanceOf(Date);
  });

  it('BURNS the token, making the link single-use', async () => {
    p.parentalConsent.findFirst.mockResolvedValue({
      id: 'c1', familyId: FAMILY, parentId: PARENT, status: 'pending', method: ACTIVE_METHOD_ID, expiresAt: null,
    });
    await ConsentService.verifyConsent({ rawToken: RAW });
    expect(p.parentalConsent.update.mock.calls[0][0].data.tokenHash).toBeNull();
  });

  it('sends the "plus" confirmation notice — this is what makes it email-PLUS', async () => {
    // A child who reached the parent's inbox cannot consent without leaving the parent a record.
    p.parentalConsent.findFirst.mockResolvedValue({
      id: 'c1', familyId: FAMILY, parentId: PARENT, status: 'pending', method: ACTIVE_METHOD_ID, expiresAt: null,
    });
    await ConsentService.verifyConsent({ rawToken: RAW });

    const confirmation = mockSend.mock.calls.find((c) => c[0].templateData?.isConfirmation === true);
    expect(confirmation).toBeDefined();
  });

  it('stays verified even if the confirmation notice fails to send', async () => {
    p.parentalConsent.findFirst.mockResolvedValue({
      id: 'c1', familyId: FAMILY, parentId: PARENT, status: 'pending', method: ACTIVE_METHOD_ID, expiresAt: null,
    });
    mockSend.mockRejectedValue(new Error('smtp down'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(ConsentService.verifyConsent({ rawToken: RAW })).resolves.toMatchObject({
      familyId: FAMILY,
    });
    jest.restoreAllMocks();
  });

  it('rejects an unknown token', async () => {
    p.parentalConsent.findFirst.mockResolvedValue(null);
    await expect(ConsentService.verifyConsent({ rawToken: RAW })).rejects.toThrow(/not valid/i);
  });

  it('rejects an expired token', async () => {
    p.parentalConsent.findFirst.mockResolvedValue({
      id: 'c1', familyId: FAMILY, parentId: PARENT, status: 'pending', method: ACTIVE_METHOD_ID,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(ConsentService.verifyConsent({ rawToken: RAW })).rejects.toThrow(/expired/i);
  });

  it('is idempotent — a second click on the same link is not an error', async () => {
    p.parentalConsent.findFirst.mockResolvedValue({
      id: 'c1', familyId: FAMILY, parentId: PARENT, status: 'verified', method: ACTIVE_METHOD_ID, expiresAt: null,
    });
    await expect(ConsentService.verifyConsent({ rawToken: RAW })).resolves.toMatchObject({
      familyId: FAMILY,
    });
    expect(p.parentalConsent.update).not.toHaveBeenCalled();
  });
});

// ─── Status + pluggability ────────────────────────────────────────────────────

describe('getStatus', () => {
  it('reports "none" when nothing has been requested', async () => {
    p.parentalConsent.findUnique.mockResolvedValue(null);
    expect((await ConsentService.getStatus(FAMILY)).status).toBe('none');
  });

  it('reports an EXPIRED pending request as "none", so the UI offers a fresh start', async () => {
    p.parentalConsent.findUnique.mockResolvedValue({
      status: 'pending', method: ACTIVE_METHOD_ID, verifiedAt: null, requestedAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
    });
    expect((await ConsentService.getStatus(FAMILY)).status).toBe('none');
  });

  it('reports a live pending request as pending', async () => {
    p.parentalConsent.findUnique.mockResolvedValue({
      status: 'pending', method: ACTIVE_METHOD_ID, verifiedAt: null, requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect((await ConsentService.getStatus(FAMILY)).status).toBe('pending');
  });
});

describe('method registry', () => {
  it('exposes the active method with both halves of email-plus', () => {
    const method = getMethod();
    expect(method.id).toBe('email_plus');
    expect(typeof method.initiate).toBe('function');
    expect(typeof method.confirm).toBe('function');
  });

  it('rejects an unregistered method rather than silently using the default', () => {
    // A typo must not quietly downgrade the verification method.
    expect(() => getMethod('postcard')).toThrow(/unknown consent method/i);
  });
});
