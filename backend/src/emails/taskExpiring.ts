/**
 * emails/taskExpiring.ts — M9
 * Sent by the midnight cron when a task is due within 24 hours.
 * triggerType: 'task_expiring'
 * templateData: { childName, taskTitle, dueAt, assignmentId }
 */

import { baseLayout, ctaButton, infoRow, infoTable } from './base';

export interface TaskExpiringData {
  childName: string;
  taskTitle: string;
  dueAt: string | Date;
  assignmentId: string;
}

export function buildTaskExpiring(data: TaskExpiringData): string {
  const { childName, taskTitle, dueAt, assignmentId } = data;

  const dueDate = new Date(dueAt).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const taskUrl = `${process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'}/parent/tasks/assignments/${assignmentId}`;

  const inner = `
  <!-- Body -->
  <tr>
    <td style="padding:40px 40px 16px;">
      <!-- Warning badge -->
      <div style="display:inline-block;background:#fef3c7;color:#92400e;font-size:13px;
                  font-weight:600;padding:4px 12px;border-radius:20px;margin-bottom:16px;">
        ⏰ Due in less than 24 hours
      </div>
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:22px;font-weight:700;">
        Task expiring soon
      </h2>
      <p style="margin:0 0 20px;color:#475569;font-size:16px;line-height:1.6;">
        <strong>${childName}</strong> has a task that is due soon and has not yet been submitted.
      </p>

      ${infoTable([
        infoRow('Task', taskTitle),
        infoRow('Assigned to', childName),
        infoRow('Due by', dueDate),
      ].join(''))}

      ${ctaButton('View Task', taskUrl)}

      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
        You may want to remind ${childName} to complete this task before it expires.
      </p>
    </td>
  </tr>`;

  return baseLayout(
    inner,
    `Reminder: "${taskTitle}" for ${childName} is due ${dueDate}.`,
  );
}
