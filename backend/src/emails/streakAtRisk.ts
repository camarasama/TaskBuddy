/**
 * emails/streakAtRisk.ts — M9
 * Sent by the 6pm cron when a child has 0 task completions that day.
 * triggerType: 'streak_at_risk'
 * templateData: { childName, currentStreak, childId }
 */

import { baseLayout, ctaButton, infoRow, infoTable } from './base';

export interface StreakAtRiskData {
  childName: string;
  currentStreak: number;
  childId: string;
}

export function buildStreakAtRisk(data: StreakAtRiskData): string {
  const { childName, currentStreak, childId } = data;

  const childUrl = `${process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'}/parent/children/${childId}`;

  const streakLabel = currentStreak === 1 ? '1 day' : `${currentStreak} days`;
  const hasStreak = currentStreak > 0;

  const inner = `
  <!-- Body -->
  <tr>
    <td style="padding:40px 40px 16px;">
      <!-- Warning badge -->
      <div style="display:inline-block;background:#fef3c7;color:#92400e;font-size:13px;
                  font-weight:600;padding:4px 12px;border-radius:20px;margin-bottom:16px;">
        🔥 Streak at risk
      </div>
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:22px;font-weight:700;">
        ${childName} hasn't completed any tasks today
      </h2>
      <p style="margin:0 0 20px;color:#475569;font-size:16px;line-height:1.6;">
        ${hasStreak
          ? `<strong>${childName}</strong> has a <strong>${streakLabel} streak</strong> that could be broken if no tasks are completed today. There's still time to encourage them!`
          : `<strong>${childName}</strong> hasn't completed any tasks today. Encourage them to get started!`
        }
      </p>

      ${hasStreak ? infoTable([
        infoRow('Current streak', `🔥 ${streakLabel}`),
        infoRow('Tasks completed today', '0'),
      ].join('')) : ''}

      ${ctaButton("View " + childName + "'s Tasks", childUrl)}

      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
        This reminder was sent at 6pm. To disable streak reminders, visit
        your Family Settings and turn off "Streak at Risk" notifications.
      </p>
    </td>
  </tr>`;

  return baseLayout(
    inner,
    hasStreak
      ? `${childName}'s ${streakLabel} streak is at risk — no tasks completed today.`
      : `${childName} hasn't completed any tasks today.`,
  );
}
