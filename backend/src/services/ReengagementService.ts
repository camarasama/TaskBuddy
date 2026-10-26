/**
 * services/ReengagementService.ts - sends the "come back" emails (admin insights, 2026-10-26).
 *
 * The timing rules live in reengagementPolicy.ts (pure). This file does the I/O: who is eligible,
 * the actual send, the unsubscribe token, and the admin controls.
 *
 * Who never gets one:
 *   - children (parents only, always),
 *   - parents who clicked "stop tips and reminders", unverified or deactivated parents,
 *   - suspended families, families scheduled for deletion, test accounts, families an admin paused,
 *   - everyone, while the global pause is on.
 *
 * Double sends are impossible by construction: the ReengagementEmail row is CLAIMED (unique on
 * family + track + anchor + step) before any email leaves, so the daily job and an admin's
 * "send next now" racing each other produce one email, not two.
 */

import crypto from 'crypto';
import { prisma } from './database';
import { config } from '../config';
import { EmailService } from './email';
import { reengagementSubject, type ReengagementData } from '../emails/reengagement';
import {
  currentEpisode,
  dueStep,
  nextManualStep,
  planFor,
  stepsInEpisode,
  type FamilyState,
  type Plan,
  type SentStep,
  type Track,
} from './reengagementPolicy';

const SETTING_KEY = 'reengagement';
const DAY_MS = 24 * 60 * 60 * 1000;

function appUrl(): string {
  return process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000';
}

function apiUrl(): string {
  return process.env.API_URL || config.apiUrl;
}

// ─── Unsubscribe token ────────────────────────────────────────────────────────

/** Derived from the JWT secret, never the secret itself (same rule as the digest pixel key). */
function unsubscribeKey(): Buffer {
  return crypto.createHmac('sha256', config.jwt.secret).update('taskbuddy:reengagement-unsub:v1').digest();
}

export function signUnsubscribe(userId: string): string {
  return crypto.createHmac('sha256', unsubscribeKey()).update(`unsub:${userId}`).digest('hex').slice(0, 32);
}

export function verifyUnsubscribe(userId: string, token: string): boolean {
  const expected = signUnsubscribe(userId);
  return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function unsubscribeLinks(userId: string): { page: string; oneClick: string } {
  const q = `u=${encodeURIComponent(userId)}&t=${signUnsubscribe(userId)}`;
  return {
    page: `${appUrl()}/unsubscribe?${q}`,
    oneClick: `${apiUrl()}/api/v1/email/unsubscribe?${q}`,
  };
}

// ─── Loading state ────────────────────────────────────────────────────────────

const ELIGIBLE_PARENT = {
  role: 'parent' as const,
  deletedAt: null,
  isActive: true,
  emailVerifiedAt: { not: null },
  reengagementOptOutAt: null,
  email: { not: null },
};

async function activatedSet(familyIds: string[]): Promise<Set<string>> {
  if (familyIds.length === 0) return new Set();
  const rows = await prisma.$queryRaw<Array<{ family_id: string }>>`
    SELECT DISTINCT c.family_id
      FROM task_assignments ta JOIN users c ON c.id = ta.child_id
     WHERE ta.status = 'approved' AND c.family_id = ANY(${familyIds}::text[])`;
  return new Set(rows.map((r) => r.family_id));
}

function toSent(rows: Array<{ track: string; step: number; anchorAt: Date; sentAt: Date }>): SentStep[] {
  return rows.map((r) => ({ track: r.track as Track, step: r.step, anchorAt: r.anchorAt, sentAt: r.sentAt }));
}

export interface FamilyWithState {
  id: string;
  familyName: string;
  state: FamilyState;
}

/** Families that could receive an email at all, with their sequence history. */
async function loadEligibleFamilies(where: { id?: string } = {}): Promise<FamilyWithState[]> {
  const families = await prisma.family.findMany({
    where: {
      ...where,
      deletedAt: null,
      isSuspended: false,
      isTestAccount: false,
      reengagementPausedAt: null,
      users: { some: ELIGIBLE_PARENT },
    },
    select: {
      id: true,
      familyName: true,
      createdAt: true,
      lastActiveAt: true,
      reengagementEmails: { select: { track: true, step: true, anchorAt: true, sentAt: true } },
    },
  });
  const activated = await activatedSet(families.map((f) => f.id));
  return families.map((f) => ({
    id: f.id,
    familyName: f.familyName,
    state: {
      createdAt: f.createdAt,
      lastActiveAt: f.lastActiveAt,
      activated: activated.has(f.id),
      sent: toSent(f.reengagementEmails),
    },
  }));
}

/** Facts for the lapsed step-1 email. Child names go to their own parent only. */
async function familyStats(familyId: string): Promise<ReengagementData['stats']> {
  const [tasksDone, rewardsEarned, best] = await Promise.all([
    prisma.taskAssignment.count({ where: { status: 'approved', child: { familyId } } }),
    prisma.rewardRedemption.count({ where: { child: { familyId }, status: { not: 'cancelled' } } }),
    prisma.childProfile.findFirst({
      where: { user: { familyId, deletedAt: null } },
      orderBy: { longestStreakDays: 'desc' },
      select: { longestStreakDays: true, user: { select: { firstName: true } } },
    }),
  ]);
  return {
    tasksDone,
    rewardsEarned,
    streakChildName: best?.user.firstName ?? null,
    streakDays: best?.longestStreakDays ?? null,
  };
}

// ─── Sending ──────────────────────────────────────────────────────────────────

export interface SendOutcome {
  sent: boolean;
  recipients: number;
  reason?: string;
}

async function sendStep(
  family: { id: string; familyName: string },
  track: Track,
  anchorAt: Date,
  step: number,
  sentBy: string | null,
  now: Date,
): Promise<SendOutcome> {
  // Claim first. A unique violation means someone else already sent this step.
  let rowId: string;
  try {
    const row = await prisma.reengagementEmail.create({
      data: { familyId: family.id, track, step, anchorAt, sentAt: now, recipients: 0, sentBy },
      select: { id: true },
    });
    rowId = row.id;
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') return { sent: false, recipients: 0, reason: 'already sent' };
    throw err;
  }

  const parents = await prisma.user.findMany({
    where: { familyId: family.id, ...ELIGIBLE_PARENT },
    select: { id: true, firstName: true, email: true },
  });
  const stats = track === 'lapsed' && step === 1 ? await familyStats(family.id) : undefined;

  let recipients = 0;
  for (const p of parents) {
    if (!p.email) continue;
    const links = unsubscribeLinks(p.id);
    const data: ReengagementData = {
      track,
      step,
      firstName: p.firstName,
      familyName: family.familyName,
      appUrl: appUrl(),
      unsubscribeUrl: links.page,
      stats,
    };
    try {
      const result = await EmailService.send({
        triggerType: 'reengagement',
        toEmail: p.email,
        toUserId: p.id,
        familyId: family.id,
        subject: reengagementSubject(data),
        templateData: data as unknown as Record<string, unknown>,
        referenceType: 'reengagement_email',
        referenceId: rowId,
        headers: {
          'List-Unsubscribe': `<${links.oneClick}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      if (result === 'sent') recipients++;
    } catch (err) {
      console.error(`[Reengagement] send failed for user ${p.id}:`, (err as Error)?.message);
    }
  }

  if (recipients === 0) {
    // Nobody got it (cap, preference, SMTP). Release the claim so a later run can try again.
    await prisma.reengagementEmail.delete({ where: { id: rowId } }).catch(() => undefined);
    return { sent: false, recipients: 0, reason: 'no parent could receive it right now' };
  }
  await prisma.reengagementEmail.update({ where: { id: rowId }, data: { recipients } });
  return { sent: true, recipients };
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function isGloballyPaused(): Promise<boolean> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
  return Boolean((row?.value as { paused?: boolean } | null)?.paused);
}

export const ReengagementService = {
  isGloballyPaused,

  async setGloballyPaused(paused: boolean, adminId: string): Promise<void> {
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: { paused }, updatedBy: adminId },
      update: { value: { paused }, updatedBy: adminId },
    });
  },

  async setFamilyPaused(familyId: string, paused: boolean): Promise<void> {
    await prisma.family.update({
      where: { id: familyId },
      data: { reengagementPausedAt: paused ? new Date() : null },
    });
  },

  /** The daily job. Returns counts for the log line. */
  async runDaily(now: Date = new Date()): Promise<{ considered: number; sent: number; paused: boolean }> {
    if (await isGloballyPaused()) return { considered: 0, sent: 0, paused: true };
    const families = await loadEligibleFamilies();
    let sent = 0;
    for (const f of families) {
      try {
        const ep = currentEpisode(f.state, now);
        if (!ep) continue;
        const step = dueStep(ep, stepsInEpisode(f.state.sent, ep), now);
        if (!step) continue;
        const outcome = await sendStep(f, ep.track, ep.anchorAt, step, null, now);
        if (outcome.sent) sent++;
      } catch (err) {
        console.error(`[Reengagement] family ${f.id} failed:`, (err as Error)?.message);
      }
    }
    return { considered: families.length, sent, paused: false };
  },

  /** Admin "send next now": the next step of the current episode, ignoring the calendar. */
  async sendNextNow(familyId: string, adminId: string, now: Date = new Date()): Promise<SendOutcome & { step?: number; track?: Track }> {
    const [f] = await loadEligibleFamilies({ id: familyId });
    if (!f) return { sent: false, recipients: 0, reason: 'This family cannot receive re-engagement email (paused, test account, suspended, or no parent who accepts it).' };
    const ep = currentEpisode(f.state, now, { ignoreQuiet: true });
    if (!ep) return { sent: false, recipients: 0, reason: 'No sequence applies to this family right now.' };
    const step = nextManualStep(stepsInEpisode(f.state.sent, ep));
    if (!step) return { sent: false, recipients: 0, reason: 'Every email in this sequence has already been sent.' };
    const outcome = await sendStep(f, ep.track, ep.anchorAt, step, adminId, now);
    return { ...outcome, step, track: ep.track };
  },

  /** Send one template to the admin's own inbox with sample data. Nothing is recorded as sent. */
  async sendTest(params: { toEmail: string; firstName: string; track: Track; step: number }): Promise<void> {
    const data: ReengagementData = {
      track: params.track,
      step: params.step,
      firstName: params.firstName,
      familyName: 'Sample',
      appUrl: appUrl(),
      unsubscribeUrl: `${appUrl()}/unsubscribe`,
      stats: { tasksDone: 23, rewardsEarned: 2, streakChildName: 'Sam', streakDays: 6 },
    };
    await EmailService.send({
      triggerType: 'reengagement',
      toEmail: params.toEmail,
      toUserId: null,
      familyId: null,
      subject: `[Test] ${reengagementSubject(data)}`,
      templateData: data as unknown as Record<string, unknown>,
      skipPreferenceCheck: true,
    });
  },

  /** Plans for many families at once, for the admin "needs a nudge" table. */
  async plansFor(familyIds: string[], now: Date = new Date()): Promise<Map<string, Plan | null>> {
    const out = new Map<string, Plan | null>();
    if (familyIds.length === 0) return out;
    const [rows, activated] = await Promise.all([
      prisma.family.findMany({
        where: { id: { in: familyIds } },
        select: {
          id: true,
          createdAt: true,
          lastActiveAt: true,
          reengagementEmails: { select: { track: true, step: true, anchorAt: true, sentAt: true } },
        },
      }),
      activatedSet(familyIds),
    ]);
    for (const r of rows) {
      out.set(
        r.id,
        planFor(
          { createdAt: r.createdAt, lastActiveAt: r.lastActiveAt, activated: activated.has(r.id), sent: toSent(r.reengagementEmails) },
          now,
        ),
      );
    }
    return out;
  },

  /** Unsubscribe from the email link or the one-click header. Idempotent. */
  async optOut(userId: string): Promise<boolean> {
    const res = await prisma.user.updateMany({
      where: { id: userId, reengagementOptOutAt: null },
      data: { reengagementOptOutAt: new Date() },
    });
    return res.count > 0;
  },

  /** Numbers for the re-engagement page. */
  async stats(now: Date = new Date()) {
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const rows = await prisma.reengagementEmail.findMany({
      select: { familyId: true, track: true, step: true, sentAt: true, recipients: true, returnedAt: true },
    });
    const steps = (['setup', 'lapsed'] as Track[]).map((track) => ({
      track,
      steps: [1, 2, 3, 4].map((step) => {
        const mine = rows.filter((r) => r.track === track && r.step === step);
        return {
          step,
          sent: mine.length,
          cameBack: mine.filter((r) => r.returnedAt).length,
        };
      }),
    }));
    const recent = rows.filter((r) => r.sentAt >= since30);
    const inTrack = new Set(recent.filter((r) => !r.returnedAt).map((r) => r.familyId));
    const returned = new Set(recent.filter((r) => r.returnedAt).map((r) => r.familyId));
    const [unsubscribes, paused] = await Promise.all([
      prisma.user.count({ where: { reengagementOptOutAt: { not: null } } }),
      isGloballyPaused(),
    ]);
    return {
      paused,
      familiesInTrack: inTrack.size,
      emailsSent30d: recent.reduce((n, r) => n + r.recipients, 0),
      familiesEmailed30d: new Set(recent.map((r) => r.familyId)).size,
      familiesReturned30d: returned.size,
      unsubscribes,
      steps,
    };
  },
};
