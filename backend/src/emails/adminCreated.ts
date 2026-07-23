export interface AdminCreatedData {
  adminFirstName: string;
  newAdminEmail: string;
}

/**
 * Security notice to existing admins: a new admin account was just created. Admin creation is a
 * high-privilege event, so every current admin is told when it happens.
 */
export function buildAdminCreated(data: AdminCreatedData): string {
  return `
    <tr>
      <td style="padding:32px 40px 24px;text-align:center;">
        <div style="font-size:48px;margin-bottom:16px;">🛡️</div>
        <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">
          A new admin account was created
        </h2>
        <p style="margin:0 0 16px;color:#64748b;font-size:16px;">
          Hi ${data.adminFirstName}, a new TaskBuddy admin account was just created for
          <strong>${data.newAdminEmail}</strong>.
        </p>
        <p style="margin:0 0 8px;color:#64748b;font-size:16px;">
          If you were expecting this, no action is needed. If you did not authorize it, review the
          admin list and audit log immediately.
        </p>
      </td>
    </tr>
  `;
}
