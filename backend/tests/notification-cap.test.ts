/**
 * U14 — the global email frequency cap (growth roadmap §8).
 *
 * The roadmap said to adopt this BEFORE shipping new triggers. It was not, and this run has since
 * added the weekly digest, parent-push-on-submit and the consent emails on top of an existing
 * thirteen. Unsubscribes are unrecoverable, so this is overdue rather than premature.
 *
 * **The classification is the whole design**, and getting it wrong is bad in two different
 * directions — cap something transactional and a parent cannot reset their password; cap nothing and
 * a busy family gets six emails on a Tuesday and mutes the sender forever. Hence most of the tests
 * below are about which category a trigger falls into, not about the arithmetic.
 */

jest.mock('../src/services/database', () => ({
  prisma: { emailLog: { findMany: jest.fn() } },
}));

import {
  CAP_EXEMPT,
  DAILY_LIMIT,
  NotificationPolicy,
  TRANSACTIONAL,
  WEEKLY_LIMIT,
  checkCap,
  isCapped,
} from '../src/services/NotificationPolicy';
import { prisma } from '../src/services/database';

const p = prisma as unknown as { emailLog: { findMany: jest.Mock } };

const USER = 'user-1';
const NOW = new Date('2026-07-26T12:00:00Z');

/** n lifecycle sends, `hoursAgo` before NOW. */
function sends(n: number, hoursAgo: number, triggerType = 'streak_at_risk') {
  return Array.from({ length: n }, () => ({
    triggerType,
    createdAt: new Date(NOW.getTime() - hoursAgo * 3_600_000),
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  p.emailLog.findMany.mockResolvedValue([]);
});

// ─── Classification — the part that matters most ──────────────────────────────

describe('classification', () => {
  it('never caps anything needed for account access or recovery', () => {
    // Capping any of these would lock a real person out of their own account.
    for (const t of ['email_verification', 'password_reset', 'admin_created']) {
      expect(isCapped(t)).toBe(false);
    }
  });

  it('never caps the COPPA consent email', () => {
    // It is legally required and it gates child creation — a cap would silently break signup.
    expect(isCapped('parental_consent')).toBe(false);
  });

  it('never caps a security notice or an invite someone is waiting on', () => {
    expect(isCapped('child_locked')).toBe(false);
    expect(isCapped('co_parent_invite')).toBe(false);
  });

  it('never caps the weekly digest', () => {
    // Capping it could silence the one message designed to be the week's only email.
    expect(isCapped('weekly_digest')).toBe(false);
    expect(CAP_EXEMPT.has('weekly_digest')).toBe(true);
  });

  it('DOES cap the high-volume nudges and celebrations', () => {
    for (const t of ['streak_at_risk', 'task_expiring', 'task_expired', 'level_up', 'reward_redeemed']) {
      expect(isCapped(t)).toBe(true);
    }
  });

  it('DOES cap task_submitted — the highest-volume trigger of all', () => {
    // A child submitting five tasks in an evening must not produce five emails. The parent still
    // gets an uncapped PUSH per submission, so the fast channel stays open.
    expect(isCapped('task_submitted')).toBe(true);
  });

  it('treats an unknown trigger as capped, not exempt', () => {
    // Fail safe: a new trigger added without thought is rationed rather than unlimited.
    expect(isCapped('some_future_trigger')).toBe(true);
  });

  it('has no overlap between the two exempt sets', () => {
    for (const t of TRANSACTIONAL) expect(CAP_EXEMPT.has(t)).toBe(false);
  });
});

// ─── The cap itself ───────────────────────────────────────────────────────────

describe('checkCap', () => {
  it('allows a lifecycle email when nothing has been sent', async () => {
    expect(await checkCap({ triggerType: 'streak_at_risk', toUserId: USER, now: NOW })).toEqual({
      allowed: true,
    });
  });

  it('blocks a second lifecycle email the same day', async () => {
    p.emailLog.findMany.mockResolvedValue(sends(DAILY_LIMIT, 2));
    const result = await checkCap({ triggerType: 'task_expiring', toUserId: USER, now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/daily cap/);
  });

  it('blocks past the weekly limit even when today is clear', async () => {
    // Three sent earlier in the week, none today: the daily gate passes and the weekly one catches it.
    p.emailLog.findMany.mockResolvedValue(sends(WEEKLY_LIMIT, 48));
    const result = await checkCap({ triggerType: 'level_up', toUserId: USER, now: NOW });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/weekly cap/);
  });

  it('allows again once the week rolls past', async () => {
    p.emailLog.findMany.mockResolvedValue([]); // the query window itself excludes older rows
    expect((await checkCap({ triggerType: 'level_up', toUserId: USER, now: NOW })).allowed).toBe(true);
  });

  it('does NOT count transactional sends toward the cap', async () => {
    // Three password resets in a week must not silence a streak nudge.
    p.emailLog.findMany.mockResolvedValue([
      ...sends(3, 30, 'password_reset'),
      ...sends(2, 40, 'parental_consent'),
    ]);
    expect((await checkCap({ triggerType: 'streak_at_risk', toUserId: USER, now: NOW })).allowed).toBe(
      true,
    );
  });

  it('does NOT count the digest toward the cap', async () => {
    p.emailLog.findMany.mockResolvedValue(sends(3, 30, 'weekly_digest'));
    expect((await checkCap({ triggerType: 'level_up', toUserId: USER, now: NOW })).allowed).toBe(true);
  });

  it('never blocks a transactional email, however many have been sent', async () => {
    p.emailLog.findMany.mockResolvedValue(sends(50, 1));
    expect(
      (await checkCap({ triggerType: 'password_reset', toUserId: USER, now: NOW })).allowed,
    ).toBe(true);
  });

  it('never blocks the digest', async () => {
    p.emailLog.findMany.mockResolvedValue(sends(50, 1));
    expect((await checkCap({ triggerType: 'weekly_digest', toUserId: USER, now: NOW })).allowed).toBe(
      true,
    );
  });

  it('does not cap a recipient with no user record', async () => {
    // Pre-registration invitees have no history to count, and those sends are transactional anyway.
    expect((await checkCap({ triggerType: 'co_parent_invite', toUserId: null, now: NOW })).allowed).toBe(
      true,
    );
    expect(p.emailLog.findMany).not.toHaveBeenCalled();
  });

  it('counts only SUCCESSFUL sends', async () => {
    // A bounce reached nobody; counting it would silence the retry as well as the original.
    await checkCap({ triggerType: 'level_up', toUserId: USER, now: NOW });
    expect(p.emailLog.findMany.mock.calls[0][0].where.status).toBe('sent');
  });

  it('scopes the lookup to the recipient and the last week', async () => {
    await checkCap({ triggerType: 'level_up', toUserId: USER, now: NOW });
    const where = p.emailLog.findMany.mock.calls[0][0].where;
    expect(where.toUserId).toBe(USER);
    expect(where.createdAt.gte.getTime()).toBe(NOW.getTime() - 7 * 24 * 3_600_000);
  });

  // The failure mode that would be worst and least visible.
  it('FAILS OPEN when the check itself errors', async () => {
    // A throttle that silently swallowed mail because a count query failed would be a worse bug
    // than the fatigue it prevents, and nobody would ever see it.
    p.emailLog.findMany.mockRejectedValue(new Error('db down'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect((await checkCap({ triggerType: 'level_up', toUserId: USER, now: NOW })).allowed).toBe(true);
    jest.restoreAllMocks();
  });
});

describe('published limits', () => {
  it('matches the policy stated in the roadmap', () => {
    expect(NotificationPolicy.DAILY_LIMIT).toBe(1);
    expect(NotificationPolicy.WEEKLY_LIMIT).toBe(3);
  });
});
