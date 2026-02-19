/**
 * emails/taskRejected.ts — M9
 * Sent to ALL parents when a task submission is rejected.
 * triggerType: 'task_rejected'
 * templateData: { childName, taskTitle, rejectionReason }
 */

import { baseLayout, infoRow, infoTable } from './base';

export interface TaskRejectedData {
  childName: string;
  taskTitle: string;
  rejectionReason?: string;
}

export function buildTaskRejected(data: TaskRejectedData): string {
  const { childName, taskTitle, rejectionReason } = data;

  const inner = `
  <!-- Body -->
  <tr>
    <td style="padding:40px 40px 16px;">
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:22px;font-weight:700;">
        Task submission rejected 🔄
      </h2>
      <p style="margin:0 0 20px;color:#475569;font-size:16px;line-height:1.6;">
        A parent has requested changes to <strong>${childName}</strong>'s submission
        for <strong>"${taskTitle}"</strong>. The task has been returned for revision.
      </p>

      ${infoTable([
        infoRow('Task', taskTitle),
        infoRow('Child', childName),
        rejectionReason ? infoRow('Reason', rejectionReason) : '',
      ].join(''))}

      <p style="margin:16px 0 0;color:#94a3b8;font-size:13px;line-height:1.6;">
        ${childName} has been notified and can resubmit once the changes are made.
        No points or XP were deducted.
      </p>
    </td>
  </tr>`;

  return baseLayout(
    inner,
    `${childName}'s submission for "${taskTitle}" was returned for changes.`,
  );
}
