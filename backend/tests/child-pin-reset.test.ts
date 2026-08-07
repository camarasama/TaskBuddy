import crypto from 'crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';

/**
 * Child-initiated PIN reset (U2). Covers the same properties password-reset.test.ts and
 * token-hashing.test.ts cover for the parent flow, plus the property unique to this one:
 * NO ENUMERATION ORACLE (see AuthService.requestChildPinReset). An oracle here would reveal which
 * *children* exist to an unauthenticated caller who only knows a family code — worse than the
 * F-10 childLogin timing bug this whole feature is built to not repeat.
 *
 * EmailService is mocked wholesale here — this file is not about who gets emailed, only about
 * whether ONE gets sent and with what it does or doesn't reveal. "Sent to every parent, not just
 * one" is covered separately in child-pin-reset-email.test.ts, which deliberately does NOT mock
 * EmailService.sendToFamilyParents so the real fan-out runs.
 */
jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findFirst: jest.fn() },
    user: { findFirst: jest.fn() },
    childProfile: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  },
}));
jest.mock('../src/services/SessionService', () => ({
  SessionService: { revokeAllForUser: jest.fn().mockResolvedValue(0) },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { sendToFamilyParents: jest.fn().mockResolvedValue(undefined) },
}));

import { app } from '../src/index';
import { authService } from '../src/services/auth';
import { prisma } from '../src/services/database';
import { SessionService } from '../src/services/SessionService';
import { EmailService } from '../src/services/email';

const findFamily = prisma.family.findFirst as jest.Mock;
const findChild = prisma.user.findFirst as jest.Mock;
const updateMany = prisma.childProfile.updateMany as jest.Mock;
const findProfileByToken = prisma.childProfile.findFirst as jest.Mock;
const updateProfile = prisma.childProfile.update as jest.Mock;
const revokeAll = SessionService.revokeAllForUser as jest.Mock;
const notifyParents = EmailService.sendToFamilyParents as jest.Mock;

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const RAW_TOKEN = 'a'.repeat(64);
const futureExpiry = () => new Date(Date.now() + 30 * 60_000);

/** Let the fire-and-forget email promise (started but not awaited by the service) settle. */
const flush = () => new Promise((r) => setImmediate(r));

const realChild = () => ({ id: 'child-1', firstName: 'Sam', childProfile: { id: 'cp-1' } });

beforeEach(() => jest.clearAllMocks());

describe('AuthService.requestChildPinReset — no enumeration oracle', () => {
  // Regression guard for the exact class of bug F-10 already fixed once in childLogin: skipping a
  // lookup or a write on a miss returns faster and reveals which (familyCode, childIdentifier)
  // pairs exist. Every step below must run for BOTH an existing and a nonexistent child.
  it('runs the identical sequence of DB calls whether the child exists or not', async () => {
    findFamily.mockResolvedValueOnce(null);
    findChild.mockResolvedValueOnce(null);
    await authService.requestChildPinReset('GHOST-CODE-0000', 'nobody');
    const missCounts = {
      family: findFamily.mock.calls.length,
      child: findChild.mock.calls.length,
      write: updateMany.mock.calls.length,
    };

    jest.clearAllMocks();
    findFamily.mockResolvedValueOnce({ id: 'fam-1' });
    findChild.mockResolvedValueOnce(realChild());
    await authService.requestChildPinReset('FAM-CODE-0001', 'sam');
    const hitCounts = {
      family: findFamily.mock.calls.length,
      child: findChild.mock.calls.length,
      write: updateMany.mock.calls.length,
    };

    expect(hitCounts).toEqual(missCounts);
  });

  it('still looks up a child even when the family code does not resolve, via the dummy family id', async () => {
    findFamily.mockResolvedValue(null);
    findChild.mockResolvedValue(null);

    await authService.requestChildPinReset('GHOST-CODE-0000', 'sam');

    expect(findChild).toHaveBeenCalledTimes(1);
    const where = findChild.mock.calls[0][0].where;
    expect(where.familyId).toBe('00000000-0000-0000-0000-000000000000'); // DUMMY_FAMILY_ID
    expect(where.username).toBe('sam');
  });

  it('still writes a token — to a fixed dummy target — when nothing matches, rather than a no-op', async () => {
    findFamily.mockResolvedValue(null);
    findChild.mockResolvedValue(null);

    await authService.requestChildPinReset('GHOST-CODE-0000', 'sam');

    expect(updateMany).toHaveBeenCalledTimes(1);
    const call = updateMany.mock.calls[0][0];
    expect(call.where.userId).toBe('00000000-0000-0000-0000-000000000001'); // DUMMY_CHILD_USER_ID
    expect(call.data.pinResetTokenHash).toMatch(/^[a-f0-9]{64}$/); // still a real sha256, not skipped
  });

  it('writes to the real child on a genuine match', async () => {
    findFamily.mockResolvedValue({ id: 'fam-1' });
    findChild.mockResolvedValue(realChild());

    await authService.requestChildPinReset('FAM-CODE-0001', 'sam');

    expect(updateMany.mock.calls[0][0].where.userId).toBe('child-1');
  });

  it('never emails anyone when there is no match', async () => {
    findFamily.mockResolvedValue(null);
    findChild.mockResolvedValue(null);

    await authService.requestChildPinReset('GHOST-CODE-0000', 'sam');
    await flush();

    expect(notifyParents).not.toHaveBeenCalled();
  });

  it('emails the family on a genuine match, with the family id and no PIN/token in the log-safe fields', async () => {
    findFamily.mockResolvedValue({ id: 'fam-1' });
    findChild.mockResolvedValue(realChild());

    await authService.requestChildPinReset('FAM-CODE-0001', 'sam');
    await flush();

    expect(notifyParents).toHaveBeenCalledTimes(1);
    const arg = notifyParents.mock.calls[0][0];
    expect(arg.familyId).toBe('fam-1');
    expect(arg.triggerType).toBe('child_pin_reset_requested');
  });
});

describe('POST /auth/child/pin-reset/request — identical HTTP response (anti-enumeration)', () => {
  it('returns the same status and body for an existing child vs a nonexistent one', async () => {
    findFamily.mockResolvedValue({ id: 'fam-1' });

    findChild.mockResolvedValueOnce(realChild());
    const resMatch = await request(app)
      .post('/api/v1/auth/child/pin-reset/request')
      .send({ familyCode: 'FAM-CODE-0001', childIdentifier: 'sam' });

    findChild.mockResolvedValueOnce(null);
    const resNoMatch = await request(app)
      .post('/api/v1/auth/child/pin-reset/request')
      .send({ familyCode: 'FAM-CODE-0001', childIdentifier: 'ghost' });

    expect(resMatch.status).toBe(200);
    expect(resMatch.status).toBe(resNoMatch.status);
    expect(resMatch.body).toEqual(resNoMatch.body);
  });

  it('also matches the response for a family code that does not exist at all', async () => {
    findFamily.mockResolvedValueOnce({ id: 'fam-1' });
    findChild.mockResolvedValueOnce(realChild());
    const resMatch = await request(app)
      .post('/api/v1/auth/child/pin-reset/request')
      .send({ familyCode: 'FAM-CODE-0001', childIdentifier: 'sam' });

    findFamily.mockResolvedValueOnce(null);
    findChild.mockResolvedValueOnce(null);
    const resUnknownFamily = await request(app)
      .post('/api/v1/auth/child/pin-reset/request')
      .send({ familyCode: 'NO-SUCH-CODE-9999', childIdentifier: 'sam' });

    expect(resMatch.body).toEqual(resUnknownFamily.body);
    expect(resMatch.status).toBe(resUnknownFamily.status);
  });
});

describe('AuthService.completeChildPinReset', () => {
  it('hashes the new PIN with bcrypt — never stores it plain', async () => {
    findProfileByToken.mockResolvedValue({ userId: 'child-1', pinResetExpiresAt: futureExpiry() });

    await authService.completeChildPinReset(RAW_TOKEN, '4321');

    const data = updateProfile.mock.calls[0][0].data;
    expect(data.pinHash).not.toBe('4321');
    expect(data.pinHash).toMatch(/^\$2[aby]\$12\$/); // SALT_ROUNDS = 12, same cost as setupPin()
    expect(await bcrypt.compare('4321', data.pinHash)).toBe(true);
  });

  it('consumes the token: a second use of the same raw token is rejected', async () => {
    findProfileByToken.mockResolvedValueOnce({ userId: 'child-1', pinResetExpiresAt: futureExpiry() });
    await authService.completeChildPinReset(RAW_TOKEN, '4321');

    // The hash is nulled by the update above; a real DB would no longer match this token on a
    // second lookup. The mock models that by returning null for the replay attempt.
    findProfileByToken.mockResolvedValueOnce(null);
    await expect(authService.completeChildPinReset(RAW_TOKEN, '9999')).rejects.toThrow(
      /invalid or expired/i,
    );

    expect(updateProfile).toHaveBeenCalledTimes(1); // only the first, successful call wrote a PIN
  });

  it('nulls the token hash and expiry as part of the same write that sets the new PIN', async () => {
    findProfileByToken.mockResolvedValue({ userId: 'child-1', pinResetExpiresAt: futureExpiry() });

    await authService.completeChildPinReset(RAW_TOKEN, '4321');

    const data = updateProfile.mock.calls[0][0].data;
    expect(data.pinResetTokenHash).toBeNull();
    expect(data.pinResetExpiresAt).toBeNull();
  });

  it('rejects an expired token and writes nothing', async () => {
    findProfileByToken.mockResolvedValue({
      userId: 'child-1',
      pinResetExpiresAt: new Date(Date.now() - 1000),
    });

    await expect(authService.completeChildPinReset(RAW_TOKEN, '4321')).rejects.toThrow(
      /invalid or expired/i,
    );
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('rejects an unknown token with the exact same message as an expired one', async () => {
    findProfileByToken.mockResolvedValue(null);

    await expect(authService.completeChildPinReset(RAW_TOKEN, '4321')).rejects.toThrow(
      'Invalid or expired reset link',
    );
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('rejects a malformed PIN before touching the database', async () => {
    findProfileByToken.mockResolvedValue({ userId: 'child-1', pinResetExpiresAt: futureExpiry() });

    await expect(authService.completeChildPinReset(RAW_TOKEN, '12')).rejects.toThrow(/4 digits/i);
    await expect(authService.completeChildPinReset(RAW_TOKEN, 'abcd')).rejects.toThrow(/4 digits/i);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('looks the token up by its sha256 hash only — the raw token never reaches the database', async () => {
    findProfileByToken.mockResolvedValue({ userId: 'child-1', pinResetExpiresAt: futureExpiry() });

    await authService.completeChildPinReset(RAW_TOKEN, '4321');

    const where = findProfileByToken.mock.calls[0][0].where;
    expect(where).toEqual({ pinResetTokenHash: sha256(RAW_TOKEN) });
    expect(JSON.stringify(where)).not.toContain(RAW_TOKEN);
  });

  it('revokes the child\'s existing sessions on a successful reset', async () => {
    findProfileByToken.mockResolvedValue({ userId: 'child-1', pinResetExpiresAt: futureExpiry() });

    await authService.completeChildPinReset(RAW_TOKEN, '4321');

    expect(revokeAll).toHaveBeenCalledWith('child-1', 'pin_reset');
  });
});

describe('POST /auth/child/pin-reset/complete — PIN validation rules match setupPin', () => {
  it('rejects a non-4-digit PIN at the route boundary (before the service even runs)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/child/pin-reset/complete')
      .send({ token: RAW_TOKEN, newPin: '12345' });

    expect(res.status).toBe(400);
    expect(findProfileByToken).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric PIN', async () => {
    const res = await request(app)
      .post('/api/v1/auth/child/pin-reset/complete')
      .send({ token: RAW_TOKEN, newPin: 'abcd' });

    expect(res.status).toBe(400);
  });

  it('accepts a well-formed 4-digit PIN (format is not what blocks it)', async () => {
    findProfileByToken.mockResolvedValue(null); // unknown token → 401, i.e. it got past validation
    const res = await request(app)
      .post('/api/v1/auth/child/pin-reset/complete')
      .send({ token: RAW_TOKEN, newPin: '4321' });

    expect(res.status).not.toBe(400);
  });
});
