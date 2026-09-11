/**
 * Self-service account deletion (Play data-deletion policy).
 *
 * The thing under test is a scheduler, not a deleter: the only write it is allowed to make is
 * `family.deletedAt`. Several tests below assert on what is NOT called, because the failure that
 * matters here is not "deletion did not happen" but "deletion happened too early, or to the wrong
 * family, or without the password". `RetentionService` owns the destruction and has its own tests.
 */
import bcrypt from 'bcrypt';

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findUnique: jest.fn() },
    family: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}), delete: jest.fn() },
  },
}));

jest.mock('../src/services/AuditService', () => ({
  AuditService: { logAction: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../src/services/email', () => ({
  EmailService: { sendToFamilyParents: jest.fn().mockResolvedValue(undefined) },
}));

import { AccountDeletionService } from '../src/services/AccountDeletionService';
import { AuditService } from '../src/services/AuditService';
import { config } from '../src/config';
import { prisma } from '../src/services/database';
import { EmailService } from '../src/services/email';

const findUser = prisma.user.findUnique as jest.Mock;
const findFamily = prisma.family.findUnique as jest.Mock;
const updateFamily = prisma.family.update as jest.Mock;
const deleteFamily = prisma.family.delete as jest.Mock;
const logAction = AuditService.logAction as jest.Mock;
const notify = EmailService.sendToFamilyParents as jest.Mock;

const ACTOR = { userId: 'parent1', familyId: 'fam1', ipAddress: '203.0.113.9' };

function primaryParent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'parent1',
    familyId: 'fam1',
    role: 'parent',
    isPrimaryParent: true,
    passwordHash: '$2b$12$hash',
    firstName: 'Ama',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findUser.mockResolvedValue(primaryParent());
  findFamily.mockResolvedValue({ deletedAt: null, familyName: 'The Mensahs' });
  updateFamily.mockResolvedValue({});
  jest.spyOn(bcrypt, 'compare').mockResolvedValue(true as never);
});

afterEach(() => jest.restoreAllMocks());

describe('scheduling a deletion', () => {
  it('sets deletedAt and reports the purge date one retention window out', async () => {
    const before = Date.now();
    const status = await AccountDeletionService.schedule(ACTOR, 'correct horse');

    expect(updateFamily).toHaveBeenCalledWith({
      where: { id: 'fam1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(status.scheduled).toBe(true);
    expect(status.graceDays).toBe(config.retention.days);

    const gap = new Date(status.purgeAfter!).getTime() - new Date(status.requestedAt!).getTime();
    expect(gap).toBe(config.retention.days * 86_400_000);
    expect(new Date(status.requestedAt!).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('never hard-deletes anything itself', async () => {
    await AccountDeletionService.schedule(ACTOR, 'correct horse');
    expect(deleteFamily).not.toHaveBeenCalled();
  });

  it('refuses a wrong password, and writes nothing', async () => {
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(false as never);

    await expect(AccountDeletionService.schedule(ACTOR, 'guess')).rejects.toThrow(
      /password is not correct/i,
    );
    expect(updateFamily).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(logAction).not.toHaveBeenCalled();
  });

  it('refuses a parent who is not the primary parent', async () => {
    findUser.mockResolvedValue(primaryParent({ isPrimaryParent: false }));

    await expect(AccountDeletionService.schedule(ACTOR, 'correct horse')).rejects.toThrow(
      /only the primary parent/i,
    );
    expect(updateFamily).not.toHaveBeenCalled();
  });

  it('refuses an actor whose token names a different family than their user record', async () => {
    // Defence in depth behind familyIsolation: a token minted for another family must not be able
    // to schedule the deletion of this one.
    findUser.mockResolvedValue(primaryParent({ familyId: 'someone-elses-family' }));

    await expect(AccountDeletionService.schedule(ACTOR, 'correct horse')).rejects.toThrow(
      /not found/i,
    );
    expect(updateFamily).not.toHaveBeenCalled();
  });

  it('does not move the date when asked twice', async () => {
    const alreadyScheduled = new Date('2026-09-01T10:00:00.000Z');
    findFamily.mockResolvedValue({ deletedAt: alreadyScheduled, familyName: 'The Mensahs' });

    const status = await AccountDeletionService.schedule(ACTOR, 'correct horse');

    expect(status.requestedAt).toBe(alreadyScheduled.toISOString());
    // The second request is a no-op: writing again would push the purge a further 30 days out and
    // turn a fixed window into an open-ended lease.
    expect(updateFamily).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('tells every parent, naming who asked', async () => {
    await AccountDeletionService.schedule(ACTOR, 'correct horse');

    expect(notify).toHaveBeenCalledTimes(1);
    const arg = notify.mock.calls[0][0];
    expect(arg.triggerType).toBe('account_deletion_scheduled');
    expect(arg.familyId).toBe('fam1');
    expect(arg.templateData.requestedByName).toBe('Ama');
    expect(arg.templateData.graceDays).toBe(config.retention.days);
    // Each co-parent is greeted by their own name rather than the requester's.
    expect(arg.templateDataBuilder({ firstName: 'Kwame' })).toEqual({ parentFirstName: 'Kwame' });
  });

  it('still schedules when the notification email fails', async () => {
    notify.mockRejectedValue(new Error('SMTP down'));

    await expect(AccountDeletionService.schedule(ACTOR, 'correct horse')).resolves.toMatchObject({
      scheduled: true,
    });
    expect(updateFamily).toHaveBeenCalled();
  });

  it('records an audit entry carrying the purge date', async () => {
    await AccountDeletionService.schedule(ACTOR, 'correct horse');

    expect(logAction).toHaveBeenCalledTimes(1);
    const entry = logAction.mock.calls[0][0];
    expect(entry).toMatchObject({
      actorId: 'parent1',
      action: 'DELETE',
      resourceType: 'family',
      resourceId: 'fam1',
      ipAddress: '203.0.113.9',
    });
    expect(entry.metadata.event).toBe('account_deletion_scheduled');
    expect(Date.parse(entry.metadata.purgeAfter)).not.toBeNaN();
  });
});

describe('cancelling a deletion', () => {
  beforeEach(() => {
    findFamily.mockResolvedValue({
      deletedAt: new Date('2026-09-01T10:00:00.000Z'),
      familyName: 'The Mensahs',
    });
  });

  it('clears deletedAt and reports nothing scheduled', async () => {
    const status = await AccountDeletionService.cancel(ACTOR);

    expect(updateFamily).toHaveBeenCalledWith({
      where: { id: 'fam1' },
      data: { deletedAt: null },
    });
    expect(status).toMatchObject({ scheduled: false, requestedAt: null, purgeAfter: null });
  });

  it('is a no-op when nothing is scheduled', async () => {
    findFamily.mockResolvedValue({ deletedAt: null, familyName: 'The Mensahs' });

    await expect(AccountDeletionService.cancel(ACTOR)).resolves.toMatchObject({ scheduled: false });
    expect(updateFamily).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('requires no password, but still requires the primary parent', async () => {
    // Asymmetric on purpose: cancelling is the safe direction. Making it as hard as deleting would
    // mean a parent who cannot remember their password watches the clock run out.
    findUser.mockResolvedValue(primaryParent({ isPrimaryParent: false }));

    await expect(AccountDeletionService.cancel(ACTOR)).rejects.toThrow(/only the primary parent/i);
  });

  it('sends the all-clear to every parent', async () => {
    await AccountDeletionService.cancel(ACTOR);

    const arg = notify.mock.calls[0][0];
    expect(arg.triggerType).toBe('account_deletion_cancelled');
    expect(arg.templateData.cancelledByName).toBe('Ama');
  });
});

describe('reading the status', () => {
  it('reports the window for a scheduled family', async () => {
    findFamily.mockResolvedValue({ deletedAt: new Date('2026-09-01T10:00:00.000Z') });

    const status = await AccountDeletionService.getStatus('fam1');

    expect(status.scheduled).toBe(true);
    expect(status.requestedAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('reports the grace period even when nothing is scheduled, so the UI can state it', async () => {
    findFamily.mockResolvedValue({ deletedAt: null });

    const status = await AccountDeletionService.getStatus('fam1');

    expect(status).toEqual({
      scheduled: false,
      requestedAt: null,
      purgeAfter: null,
      graceDays: config.retention.days,
    });
  });
});
