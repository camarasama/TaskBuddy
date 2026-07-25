/**
 * emails/weeklyDigest.ts — the Monday roll-up (growth roadmap §3.3, #2 priority).
 * triggerType: 'weekly_digest'
 *
 * The one feature that proves value to the parent without them opening the app. Everything in it
 * deep-links back in, and it closes on a single suggested action rather than a wall of numbers.
 *
 * Never sent for a silent week — DigestService returns null for those, because a "0 tasks, 0 points"
 * email trains parents to ignore the sender and unsubscribes are unrecoverable.
 */

import { baseLayout, ctaButton } from './base';

export interface WeeklyDigestChild {
  firstName: string;
  tasksApproved: number;
  pointsEarned: number;
  pointsSpent: number;
  currentStreak: number;
  achievementsUnlocked: number;
}

export interface WeeklyDigestData {
  parentFirstName: string;
  weekLabel: string;
  children: WeeklyDigestChild[];
  pendingApprovals: number;
  expiringRewards: Array<{ name: string; expiresAt: string }>;
  totals: { tasksApproved: number; pointsEarned: number };
  suggestedAction: string;
  /** Absolute URL of the 1x1 open-tracking pixel. Omitted when tracking is unavailable. */
  trackingPixelUrl?: string;
}

function appUrl(): string {
  return (
    process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'
  );
}

function childRow(child: WeeklyDigestChild): string {
  const streak =
    child.currentStreak > 0
      ? `<span style="color:#ea580c;font-weight:600;">🔥 ${child.currentStreak}-day streak</span>`
      : '<span style="color:#94a3b8;">no streak yet</span>';

  const unlocks =
    child.achievementsUnlocked > 0
      ? `<div style="margin-top:4px;color:#7c3aed;font-size:13px;">🏆 ${child.achievementsUnlocked} new achievement${child.achievementsUnlocked === 1 ? '' : 's'}</div>`
      : '';

  return `
  <tr>
    <td style="padding:14px 0;border-bottom:1px solid #f1f5f9;">
      <div style="font-weight:700;color:#0f172a;font-size:15px;">${child.firstName}</div>
      <div style="margin-top:4px;color:#475569;font-size:14px;">
        ${child.tasksApproved} task${child.tasksApproved === 1 ? '' : 's'} approved
        &nbsp;·&nbsp; <span style="color:#ca8a04;font-weight:600;">+${child.pointsEarned} pts</span>
        ${child.pointsSpent > 0 ? `&nbsp;·&nbsp; <span style="color:#64748b;">−${child.pointsSpent} spent</span>` : ''}
      </div>
      <div style="margin-top:4px;font-size:13px;">${streak}</div>
      ${unlocks}
    </td>
  </tr>`;
}

export function buildWeeklyDigest(data: WeeklyDigestData): string {
  const {
    parentFirstName,
    weekLabel,
    children,
    pendingApprovals,
    expiringRewards,
    totals,
    suggestedAction,
    trackingPixelUrl,
  } = data;

  const base = appUrl();

  const pendingBlock =
    pendingApprovals > 0
      ? `
  <tr>
    <td style="padding:0 40px 8px;">
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 16px;">
        <div style="font-weight:700;color:#92400e;font-size:15px;">
          ${pendingApprovals} task${pendingApprovals === 1 ? '' : 's'} waiting for you
        </div>
        <div style="color:#a16207;font-size:13px;margin-top:2px;">
          Your child has finished ${pendingApprovals === 1 ? 'it' : 'them'} and is waiting on the points.
        </div>
      </div>
    </td>
  </tr>`
      : '';

  const expiringBlock =
    expiringRewards.length > 0
      ? `
  <tr>
    <td style="padding:8px 40px 0;">
      <div style="color:#64748b;font-size:13px;">
        <strong style="color:#334155;">Expiring soon:</strong>
        ${expiringRewards.map((r) => r.name).join(' · ')}
      </div>
    </td>
  </tr>`
      : '';

  const inner = `
  <tr>
    <td style="padding:36px 40px 8px;">
      <h2 style="margin:0 0 6px;color:#0f172a;font-size:20px;font-weight:700;">
        Your week, ${parentFirstName}
      </h2>
      <p style="margin:0;color:#64748b;font-size:14px;">${weekLabel}</p>
    </td>
  </tr>

  <tr>
    <td style="padding:16px 40px 8px;">
      <div style="background:#f8fafc;border-radius:10px;padding:16px;text-align:center;">
        <span style="font-size:28px;font-weight:700;color:#0f172a;">${totals.tasksApproved}</span>
        <span style="color:#64748b;font-size:14px;"> task${totals.tasksApproved === 1 ? '' : 's'} approved</span>
        <span style="color:#cbd5e1;"> &nbsp;|&nbsp; </span>
        <span style="font-size:28px;font-weight:700;color:#ca8a04;">${totals.pointsEarned}</span>
        <span style="color:#64748b;font-size:14px;"> points earned</span>
      </div>
    </td>
  </tr>

  ${pendingBlock}

  <tr>
    <td style="padding:16px 40px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        ${children.map(childRow).join('')}
      </table>
    </td>
  </tr>

  ${expiringBlock}

  <tr>
    <td style="padding:20px 40px 8px;">
      <div style="background:#eef2ff;border-radius:10px;padding:14px 16px;color:#3730a3;font-size:14px;line-height:1.5;">
        <strong>One thing to try:</strong><br>${suggestedAction}
      </div>
    </td>
  </tr>

  <tr>
    <td style="padding:12px 40px 36px;text-align:center;">
      ${ctaButton(pendingApprovals > 0 ? 'Review and approve' : 'Open TaskBuddy', pendingApprovals > 0 ? `${base}/parent/tasks?tab=pending` : `${base}/parent/dashboard`)}
    </td>
  </tr>

  ${
    // 1x1 open pixel. Last element so a client that blocks it changes nothing above.
    trackingPixelUrl
      ? `<tr><td style="line-height:0;font-size:0;"><img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:block;border:0;"></td></tr>`
      : ''
  }`;

  return baseLayout(
    inner,
    `${totals.tasksApproved} tasks approved, ${totals.pointsEarned} points earned`,
  );
}
