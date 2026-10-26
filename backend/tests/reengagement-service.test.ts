/**
 * ReengagementService: the I/O around the timing rules. What matters here is who is NEVER emailed
 * and that a step can never go out twice.
 */

jest.mock('../src/services/database', () => ({
  prisma: {
    family: { findMany: jest.fn(), update: jest.fn() },
    user: { findMany: jest.fn(), updateMany: jest.fn() },
    reengagementEmail: { create: jest.fn(), update: jest.fn(), delete: jest.fn(), findMany: jest.fn() },
    systemSetting: { findUnique: jest.fn(), upsert: jest.fn() },
    taskAssignment: { count: jest.fn().mockResolvedValue(0) },
    rewardRedemption: { count: jest.fn().mockResolvedValue(0) },
    childProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn() },
}));

import { prisma } from '../src/services/database';
import { EmailService } from '../src/services/email';
import {
  ReengagementService,
  signUnsubscribe,
  unsubscribeLinks,
  verifyUnsubscribe,
} from '../src/services/ReengagementService';

const p = prisma as unknown as {
  family: { findMany: jest.Mock };
  user: { findMany: jest.Mock; updateMany: jest.Mock };
  reengagementEmail: { create: jest.Mock; update: jest.Mock; delete: jest.Mock };
  systemSetting: { findUnique: jest.Mock };
  $queryRaw: jest.Mock;
};
const send = EmailService.send as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-26T17:00:00Z');
const USER = '0b6f2f4e-4e8e-4b7a-9d55-1d0c1c0c0c01';

function quietSetupFamily() {
  const created = new Date(NOW.getTime() - 3 * DAY);
  return { id: 'f1', familyName: 'Diallo', createdAt: created, lastActiveAt: created, reengagementEmails: [] };
}

beforeEach(() => {
  jest.clearAllMocks();
  p.systemSetting.findUnique.mockResolvedValue(null);
  p.$queryRaw.mockResolvedValue([]); // nobody activated
  p.reengagementEmail.create.mockResolvedValue({ id: 'r1' });
  p.reengagementEmail.update.mockResolvedValue({});
  p.reengagementEmail.delete.mockResolvedValue({});
  p.user.findMany.mockResolvedValue([{ id: USER, firstName: 'Amina', email: 'amina@example.com' }]);
  send.mockResolvedValue('sent');
});

describe('unsubscribe token', () => {
  it('verifies its own signature and rejects others', () => {
    const t = signUnsubscribe(USER);
    expect(verifyUnsubscribe(USER, t)).toBe(true);
    expect(verifyUnsubscribe(USER, 'f'.repeat(32))).toBe(false);
    expect(verifyUnsubscribe('another-user', t)).toBe(false);
    expect(verifyUnsubscribe(USER, 'short')).toBe(false);
  });

  it('builds a web page link and a one-click API link', () => {
    const links = unsubscribeLinks(USER);
    expect(links.page).toContain('/unsubscribe?u=');
    expect(links.oneClick).toContain('/api/v1/email/unsubscribe?u=');
  });
});

describe('runDaily', () => {
  it('does nothing while the global pause is on', async () => {
    p.systemSetting.findUnique.mockResolvedValue({ value: { paused: true } });
    const r = await ReengagementService.runDaily(NOW);
    expect(r.paused).toBe(true);
    expect(p.family.findMany).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('only loads families that may be emailed at all', async () => {
    p.family.findMany.mockResolvedValue([]);
    await ReengagementService.runDaily(NOW);
    const where = p.family.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      deletedAt: null,
      isSuspended: false,
      isTestAccount: false,
      reengagementPausedAt: null,
    });
    // Parents only, verified, active, not opted out.
    expect(where.users.some).toMatchObject({
      role: 'parent',
      isActive: true,
      reengagementOptOutAt: null,
      emailVerifiedAt: { not: null },
    });
  });

  it('claims the step, sends with a one-click unsubscribe header, and records recipients', async () => {
    p.family.findMany.mockResolvedValue([quietSetupFamily()]);
    const r = await ReengagementService.runDaily(NOW);
    expect(r.sent).toBe(1);
    expect(p.reengagementEmail.create.mock.calls[0][0].data).toMatchObject({ familyId: 'f1', track: 'setup', step: 1 });
    const input = send.mock.calls[0][0];
    expect(input.triggerType).toBe('reengagement');
    expect(input.headers['List-Unsubscribe']).toMatch(/^<.*\/api\/v1\/email\/unsubscribe\?u=.*>$/);
    expect(input.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(p.reengagementEmail.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { recipients: 1 } });
  });

  it('sends nothing when the step was already claimed (no double send)', async () => {
    p.family.findMany.mockResolvedValue([quietSetupFamily()]);
    p.reengagementEmail.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const r = await ReengagementService.runDaily(NOW);
    expect(r.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('releases the claim when every send was suppressed, so tomorrow can retry', async () => {
    p.family.findMany.mockResolvedValue([quietSetupFamily()]);
    send.mockResolvedValue('suppressed');
    const r = await ReengagementService.runDaily(NOW);
    expect(r.sent).toBe(0);
    expect(p.reengagementEmail.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });
});

describe('sendNextNow', () => {
  it('explains why when the family cannot be emailed', async () => {
    p.family.findMany.mockResolvedValue([]);
    const r = await ReengagementService.sendNextNow('f1', 'admin1', NOW);
    expect(r.sent).toBe(false);
    expect(r.reason).toMatch(/cannot receive/);
  });

  it('sends the next step even to a recently active family, and records the admin', async () => {
    const f = { ...quietSetupFamily(), lastActiveAt: new Date(NOW.getTime() - DAY) };
    p.family.findMany.mockResolvedValue([f]);
    const r = await ReengagementService.sendNextNow('f1', 'admin1', NOW);
    expect(r).toMatchObject({ sent: true, step: 1, track: 'setup' });
    expect(p.reengagementEmail.create.mock.calls[0][0].data.sentBy).toBe('admin1');
  });
});

describe('optOut', () => {
  it('is idempotent', async () => {
    p.user.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect(await ReengagementService.optOut(USER)).toBe(true);
    expect(await ReengagementService.optOut(USER)).toBe(false);
  });
});
