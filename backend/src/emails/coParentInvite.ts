/**
 * emails/coParentInvite.ts — M9
 * Replaces the inline buildInviteEmail() that was in services/invite.ts (M4-M8).
 * Sent when a primary parent invites a co-parent to join the family.
 * triggerType: 'co_parent_invite'
 * templateData: { inviterName, familyName, acceptUrl, expiresDays }
 */

import { baseLayout, ctaButton } from './base';

export interface CoParentInviteData {
  inviterName: string;
  familyName: string;
  acceptUrl: string;
  expiresDays: number;
}

export function buildCoParentInvite(data: CoParentInviteData): string {
  const { inviterName, familyName, acceptUrl, expiresDays } = data;

  const inner = `
  <!-- Body -->
  <tr>
    <td style="padding:40px 40px 24px;">
      <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:700;">
        You've been invited! 👋
      </h2>
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        <strong>${inviterName}</strong> has invited you to join the
        <strong>${familyName}</strong> family on TaskBuddy as a co-parent.
      </p>
      <p style="margin:0 0 32px;color:#475569;font-size:16px;line-height:1.6;">
        As a co-parent you'll have full access to manage tasks, approve completions,
        and create rewards for your family.
      </p>

      ${ctaButton('Accept Invitation', acceptUrl)}
    </td>
  </tr>

  <!-- Footer note -->
  <tr>
    <td style="padding:0 40px 40px;">
      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
        This invitation expires in <strong>${expiresDays} days</strong>.
        If you didn't expect this email you can safely ignore it — no account will be created.
      </p>
      <p style="margin:12px 0 0;color:#94a3b8;font-size:12px;">
        Or copy this link:
        <a href="${acceptUrl}" style="color:#6366f1;word-break:break-all;">${acceptUrl}</a>
      </p>
    </td>
  </tr>`;

  return baseLayout(
    inner,
    `${inviterName} invited you to join ${familyName} on TaskBuddy.`,
  );
}
