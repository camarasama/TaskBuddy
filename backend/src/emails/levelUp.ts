/**
 * emails/levelUp.ts — M9
 * Sent to ALL parents when a child levels up as part of a task approval.
 * triggerType: 'level_up'
 * templateData: { childName, newLevel, bonusPoints }
 */

import { baseLayout, ctaButton, infoRow, infoTable } from './base';

export interface LevelUpData {
  childName: string;
  newLevel: number;
  bonusPoints: number;
}

export function buildLevelUp(data: LevelUpData): string {
  const { childName, newLevel, bonusPoints } = data;

  const dashboardUrl = `${process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'}/parent/dashboard`;

  const inner = `
  <!-- Body -->
  <tr>
    <td style="padding:40px 40px 16px;">
      <!-- Level up badge -->
      <div style="display:inline-block;background:#ede9fe;color:#5b21b6;font-size:13px;
                  font-weight:600;padding:4px 12px;border-radius:20px;margin-bottom:16px;">
        ⬆️ Level Up!
      </div>
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:22px;font-weight:700;">
        ${childName} levelled up! 🚀
      </h2>
      <p style="margin:0 0 20px;color:#475569;font-size:16px;line-height:1.6;">
        <strong>${childName}</strong> has reached a new level through consistent hard work.
        A bonus points reward has been automatically added to their account!
      </p>

      ${infoTable([
        infoRow('New level', `Level ${newLevel}`),
        infoRow('Bonus points awarded', `+${bonusPoints} pts`),
      ].join(''))}

      ${ctaButton('View Progress', dashboardUrl)}

      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
        Keep encouraging ${childName} — the next level awaits!
      </p>
    </td>
  </tr>`;

  return baseLayout(
    inner,
    `${childName} reached Level ${newLevel} and earned ${bonusPoints} bonus points!`,
  );
}
