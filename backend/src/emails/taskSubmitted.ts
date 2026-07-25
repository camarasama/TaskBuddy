/**
 * emails/taskSubmitted.ts - M9
 * Sent to ALL parents when a child marks a task as complete (pending review).
 * triggerType: 'task_submitted'
 * templateData: { childName, taskTitle, completedAt, assignmentId }
 */

import { baseLayout, ctaButton, infoRow, infoTable } from './base';

export interface TaskSubmittedData {
  childName: string;
  taskTitle: string;
  completedAt: string | Date;
  assignmentId: string;
}

export function buildTaskSubmitted(data: TaskSubmittedData): string {
  const { childName, taskTitle, completedAt, assignmentId } = data;

  const completedDate = new Date(completedAt).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // NOTE: this used to point at /parent/tasks/assignments/{id}, a route that has never existed -
  // every "Review Submission" click 404'd. It now targets the single-tap approval screen.
  const reviewUrl = `${process.env.FRONTEND_URL || process.env.CLIENT_URL?.split(',')[0] || 'http://localhost:3000'}/parent/approve/${assignmentId}`;

  const inner = `
  <!-- Body -->
  <tr>
    <td style="padding:40px 40px 16px;">
      <h2 style="margin:0 0 12px;color:#1e293b;font-size:22px;font-weight:700;">
        Task completed - review needed ✏️
      </h2>
      <p style="margin:0 0 20px;color:#475569;font-size:16px;line-height:1.6;">
        <strong>${childName}</strong> has marked a task as complete and is waiting for your approval.
      </p>

      ${infoTable([
        infoRow('Task', taskTitle),
        infoRow('Completed by', childName),
        infoRow('Submitted at', completedDate),
      ].join(''))}

      ${ctaButton('Approve in one tap', reviewUrl)}

      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
        Once you review, you can approve (awarding points &amp; XP) or request changes.
      </p>
    </td>
  </tr>`;

  return baseLayout(
    inner,
    `${childName} completed "${taskTitle}" - tap to review and approve.`,
  );
}
