export interface ChildAccountLockedData {
  parentFirstName: string;
  childName: string;
  lockMinutes: number;
}

/**
 * Security alert to parents: a child account was temporarily locked after repeated failed PIN
 * attempts. Informational — no action link; the lock clears itself, and the child logs back in
 * with the correct PIN once it does.
 */
export function buildChildAccountLocked(data: ChildAccountLockedData): string {
  return `
    <tr>
      <td style="padding:32px 40px 24px;text-align:center;">
        <div style="font-size:48px;margin-bottom:16px;">🔒</div>
        <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">
          ${data.childName}'s account was temporarily locked
        </h2>
        <p style="margin:0 0 16px;color:#64748b;font-size:16px;">
          Hi ${data.parentFirstName}, we locked ${data.childName}'s TaskBuddy sign-in for
          about ${data.lockMinutes} minute${data.lockMinutes === 1 ? '' : 's'} after several
          incorrect PIN attempts. This is an automatic safety measure.
        </p>
        <p style="margin:0 0 8px;color:#64748b;font-size:16px;">
          If this was just ${data.childName} mistyping their PIN, no action is needed — they can
          sign in again with the correct PIN once the lock clears.
        </p>
        <p style="margin:16px 0 0;color:#94a3b8;font-size:13px;">
          If it wasn't them, consider resetting ${data.childName}'s PIN from your parent dashboard.
        </p>
      </td>
    </tr>
  `;
}
