/**
 * emails/welcome.ts — M9
 * Sent to a new parent when they register or accept a co-parent invitation.
 * triggerType: 'welcome'
 * templateData: { firstName, familyName }
 */

import { baseLayout, ctaButton } from './base';

export interface WelcomeData {
  firstName: string;
  familyName: string;
}

export function buildWelcome(data: WelcomeData): string {
  const { firstName, familyName } = data;
  const dashboardUrl = `${process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'}/parent/dashboard`;

  const inner = `
  <!-- Body -->
  <tr>
    <td style="padding:40px 40px 16px;">
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:22px;font-weight:700;">
        Welcome to TaskBuddy, ${firstName}! 🎉
      </h2>
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        You've joined the <strong>${familyName}</strong> family on TaskBuddy.
        Here's everything you can do as a parent:
      </p>

      <!-- Feature list -->
      <table width="100%" cellpadding="8" cellspacing="0" border="0"
        style="background:#f8fafc;border-radius:8px;margin:0 0 24px;">
        <tr>
          <td style="color:#475569;font-size:14px;line-height:1.6;">
            ✅ &nbsp;<strong>Create tasks</strong> with points and difficulty levels
          </td>
        </tr>
        <tr>
          <td style="color:#475569;font-size:14px;line-height:1.6;">
            🏆 &nbsp;<strong>Approve completions</strong> and award XP &amp; Points
          </td>
        </tr>
        <tr>
          <td style="color:#475569;font-size:14px;line-height:1.6;">
            🎁 &nbsp;<strong>Set up rewards</strong> children can redeem with their points
          </td>
        </tr>
        <tr>
          <td style="color:#475569;font-size:14px;line-height:1.6;">
            📊 &nbsp;<strong>Track streaks and progress</strong> for every child
          </td>
        </tr>
      </table>

      ${ctaButton('Go to Dashboard', dashboardUrl)}

      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
        Need help getting started? Visit your Family Settings to invite a co-parent,
        add children, and customise notification preferences.
      </p>
    </td>
  </tr>`;

  return baseLayout(inner, `Welcome to TaskBuddy, ${firstName}! Your ${familyName} family is ready.`);
}
