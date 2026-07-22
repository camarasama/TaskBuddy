export interface PasswordResetData {
  firstName: string;
  resetUrl: string;
  expiryHours: number;
}

export function buildPasswordReset(data: PasswordResetData): string {
  return `
    <tr>
      <td style="padding:32px 40px 24px;text-align:center;">
        <div style="font-size:48px;margin-bottom:16px;">🔑</div>
        <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">
          Reset your password
        </h2>
        <p style="margin:0 0 24px;color:#64748b;font-size:16px;">
          Hi ${data.firstName}, we received a request to reset your TaskBuddy password.
          Click the button below to choose a new one. This link expires in ${data.expiryHours} hour${data.expiryHours === 1 ? '' : 's'}.
        </p>
        <a href="${data.resetUrl}"
           style="display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6);
                  color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;
                  font-weight:700;font-size:16px;">
          Reset Password
        </a>
        <p style="margin:24px 0 0;color:#94a3b8;font-size:13px;">
          If you didn't request a password reset, you can safely ignore this email - your password
          will not change.
        </p>
      </td>
    </tr>
  `;
}
