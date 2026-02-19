/**
 * emails/taskExpired.ts — M9
 * Sent by the midnight cron when a task passed its due date without completion.
 * triggerType: 'task_expired'
 * templateData: { childName, taskTitle, dueAt, assignmentId }
 */

import { baseLayout, ctaButton, infoRow, infoTable } from './base';

export interface TaskExpiredData {
  childName: string;
  taskTitle: string;
  dueAt: string | Date;
  assignmentId: string;
}

export function buildTaskExpired(data: TaskExpiredData): string {
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
      <!-- Expired badge -->
      <div style="display:inline-block;background:#fee2e2;color:#991b1b;font-size:13px;
                  font-weight:600;padding:4px 12px;border-radius:20px;margin-bottom:16px;">
        ❌ Task expired
      </div>
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:22px;font-weight:700;">
        Task deadline passed
      </h2>
      <p style="margin:0 0 20px;color:#475569;font-size:16px;line-height:1.6;">
        <strong>${childName}</strong>'s task passed its due date without being submitted.
        No points or XP were awarded.
      </p>

      ${infoTable([
        infoRow('Task', taskTitle),
        infoRow('Assigned to', childName),
        infoRow('Was due', dueDate),
      ].join(''))}

      ${ctaButton('View Task', taskUrl)}

      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
        You can reassign the task from the task detail page if needed.
      </p>
    </td>
  </tr>`;

  return baseLayout(
    inner,
    `"${taskTitle}" for ${childName} has expired without completion.`,
  );
}
