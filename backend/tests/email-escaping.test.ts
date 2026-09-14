import request from 'supertest';
import { escapeHtml, escapeTemplateData, renderTemplate } from '../src/emails/base';

/**
 * Names people type cannot become HTML in someone else's inbox (security audit 2026-09-14, M5).
 *
 * Templates are template literals and nothing escaped what went into them. A family registered as
 * `x</strong><p><a href="https://evil.example">Restore access</a></p><strong>` sent a working phishing
 * link inside a genuine, DKIM-signed TaskBuddy email, and the co-parent invite delivers that email to
 * any address.
 */

const HOSTILE = '</strong><p><a href="https://evil.example/restore">Restore access</a></p><strong>';

jest.mock('../src/services/database', () => ({
  prisma: {
    user: { findUnique: jest.fn(), findFirst: jest.fn() },
    familyInvitation: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
  },
}));
jest.mock('../src/services/email', () => ({
  EmailService: { send: jest.fn().mockResolvedValue(undefined) },
}));

describe('escapeTemplateData', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('reaches strings in nested arrays and objects, and leaves other values alone', () => {
    const when = new Date('2026-09-14T10:00:00Z');
    const out = escapeTemplateData({
      childName: '<b>Leo</b>',
      children: [{ firstName: '<i>Maya</i>', points: 12 }],
      expiringRewards: [{ name: 'Ice "cream"' }],
      at: when,
      count: 3,
      flag: true,
      missing: null,
    });
    expect(out).toEqual({
      childName: '&lt;b&gt;Leo&lt;/b&gt;',
      children: [{ firstName: '&lt;i&gt;Maya&lt;/i&gt;', points: 12 }],
      expiringRewards: [{ name: 'Ice &quot;cream&quot;' }],
      at: when,
      count: 3,
      flag: true,
      missing: null,
    });
  });
});

describe('rendered emails', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['co_parent_invite', { inviterName: HOSTILE, familyName: HOSTILE, acceptUrl: 'https://app.gettaskbuddy.com/invite/accept?token=a&b=c', expiresDays: 7 }],
    ['child_locked', { parentFirstName: HOSTILE, childName: HOSTILE, lockMinutes: 5 }],
    ['task_submitted', { childName: HOSTILE, taskTitle: HOSTILE, completedAt: '2026-09-14T10:00:00Z', assignmentId: 'a1' }],
    ['account_deletion_scheduled', { parentFirstName: HOSTILE, familyName: HOSTILE, requestedByName: HOSTILE, purgeDate: '2026-10-14T00:00:00Z', graceDays: 30 }],
    ['weekly_digest', {
      parentFirstName: HOSTILE,
      weekLabel: 'This week',
      children: [{ firstName: HOSTILE, tasksApproved: 1, pointsEarned: 10, pointsSpent: 0, currentStreak: 2, achievementsUnlocked: 0 }],
      pendingApprovals: 0,
      expiringRewards: [{ name: HOSTILE, expiresAt: '2026-09-20T00:00:00Z' }],
      totals: { tasksApproved: 1, pointsEarned: 10 },
      suggestedAction: `${HOSTILE} is on a 2-day streak.`,
    }],
  ];

  it.each(cases)('%s never contains the injected link', async (trigger, data) => {
    const html = await renderTemplate(trigger as never, data);
    expect(html).not.toContain('href="https://evil.example');
    expect(html).not.toContain('<a href="https://evil.example');
    expect(html).toContain('&lt;/strong&gt;&lt;p&gt;&lt;a href=&quot;https://evil.example/restore&quot;&gt;');
  });

  it('keeps a server-built link working (an escaped & inside href is still the same URL)', async () => {
    const html = await renderTemplate('co_parent_invite' as never, cases[0][1]);
    expect(html).toContain('href="https://app.gettaskbuddy.com/invite/accept?token=a&amp;b=c"');
  });
});

describe('names cannot carry line breaks into headers', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('../src/index');

  it('refuses a family name with a newline at registration', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      familyName: 'Taylor\nBcc: everyone@example.com',
      parent: { firstName: 'Sam', lastName: 'Taylor', email: 'sam@example.com', password: 'Password123!Password', dateOfBirth: '1990-01-01' },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/control characters/);
  });
});

describe('co-parent invites are capped per family per day', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { InviteService, INVITES_PER_FAMILY_PER_DAY } = require('../src/services/invite');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { prisma } = require('../src/services/database');

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({ id: 'p1', familyId: 'fam1', role: 'parent', firstName: 'Sam', lastName: 'T', family: { familyName: 'Taylor' } });
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.familyInvitation.findFirst.mockResolvedValue(null);
    prisma.familyInvitation.create.mockResolvedValue({ id: 'inv1' });
  });

  it('refuses the invite past the daily cap, before creating or sending anything', async () => {
    prisma.familyInvitation.count.mockResolvedValue(INVITES_PER_FAMILY_PER_DAY);

    await expect(
      new InviteService().sendInvite({ familyId: 'fam1', invitedByUserId: 'p1', email: 'x@example.com' }),
    ).rejects.toMatchObject({ statusCode: 429 });
    expect(prisma.familyInvitation.create).not.toHaveBeenCalled();
  });

  it('counts the last 24 hours for this family only', async () => {
    prisma.familyInvitation.count.mockResolvedValue(INVITES_PER_FAMILY_PER_DAY);
    await new InviteService().sendInvite({ familyId: 'fam1', invitedByUserId: 'p1', email: 'x@example.com' }).catch(() => {});
    const where = prisma.familyInvitation.count.mock.calls[0][0].where;
    expect(where.familyId).toBe('fam1');
    expect(Date.now() - where.createdAt.gt.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
  });
});
