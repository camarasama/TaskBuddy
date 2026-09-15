export interface AccountDeletionCancelledData {
  parentFirstName: string;
  familyName: string;
  cancelledByName: string;
}

/**
 * The all-clear, sent to every parent when a scheduled deletion is called off.
 *
 * Pairs with `accountDeletionScheduled`. A family that was told their data has a destruction date
 * must be told just as plainly when it no longer does, otherwise the only message they keep is the
 * alarming one and a co-parent spends a month believing the account is still counting down.
 */
export function buildAccountDeletionCancelled(data: AccountDeletionCancelledData): string {
  return `
    <tr>
      <td style="padding:32px 40px 24px;">
        <div style="font-size:48px;margin-bottom:16px;text-align:center;">✅</div>
        <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;text-align:center;">
          ${data.familyName} will not be deleted
        </h2>
        <p style="margin:0 0 16px;color:#64748b;font-size:16px;">
          Hi ${data.parentFirstName}, ${data.cancelledByName} cancelled the deletion request. Your
          account is active again and nothing was lost.
        </p>
        <p style="margin:0 0 16px;color:#64748b;font-size:16px;">
          Children can sign in as normal, and every task, point, reward and photo is exactly where it
          was.
        </p>
        <p style="margin:16px 0 0;color:#94a3b8;font-size:13px;">
          If you did not cancel this and believe someone else has access to your account, change your
          password and write to info@evolutionprimeit.com.
        </p>
      </td>
    </tr>
  `;
}
