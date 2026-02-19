/**
 * emails/taskApproved.ts — M9
 * Sent to ALL parents when a task submission is approved.
 * triggerType: 'task_approved'
 * templateData: { childName, taskTitle, pointsAwarded, xpAwarded, newBalance }
 */

import { baseLayout, ctaButton, infoRow, infoTable } from './base';

export interface TaskApprovedData {
  childName: string;
  taskTitle: string;
  pointsAwarded: number;
  xpAwarded: number;
  newBalance: number;
}

export function buildTaskApproved(data: TaskApprovedData): string {
  const { childName, taskTitle, pointsAwarded, xpAwarded, newBalance } = data;

  const dashboardUrl = `${process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'}/parent/dashboard`;

  const inner = `
  <!-- Body -->
  <tr>
    <td style="padding:40px 40px 16px;">
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:22px;font-weight:700;">
        Task approved! 🏆
      </h2>
      <p style="margin:0 0 20px;color:#475569;font-size:16px;line-height:1.6;">
        <strong>${childName}</strong>'s submission for <strong>"${taskTitle}"</strong> has been approved.
        Points and XP have been awarded.
      </p>

      ${infoTable([
        infoRow('Task', taskTitle),
        infoRow('Child', childName),
        infoRow('Points awarded', `+${pointsAwarded} pts`),
        infoRow('XP awarded', `+${xpAwarded} XP`),
        infoRow('New points balance', `${newBalance} pts`),
      ].join(''))}

      ${ctaButton('View Dashboard', dashboardUrl)}
    </td>
  </tr>`;

  return baseLayout(
    inner,
    `${childName} earned ${pointsAwarded} points for completing "${taskTitle}".`,
  );
}
