export interface AccountDeletionScheduledData {
  parentFirstName: string;
  familyName: string;
  /** The parent who asked. Named because a co-parent reading this did not do it. */
  requestedByName: string;
  /** ISO timestamp of when the data is destroyed. */
  purgeDate: string;
  graceDays: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Sent to every parent in the family when deletion is scheduled.
 *
 * Deliberately not celebratory and deliberately not apologetic. It has one job: make sure nobody in
 * the family discovers the deletion by finding the app broken. That is why it goes to co-parents
 * too, and why it names the person who asked rather than saying "you requested", which would be a
 * lie for every recipient except one.
 *
 * No cancel LINK. Cancelling is a signed-in action in the app, and a one-click cancel URL in an
 * email would be a way for anyone who reads the inbox to undo it. The instruction is a path, not a
 * button, for the same reason the schedule itself re-checks the password.
 */
export function buildAccountDeletionScheduled(data: AccountDeletionScheduledData): string {
  return `
    <tr>
      <td style="padding:32px 40px 24px;">
        <div style="font-size:48px;margin-bottom:16px;text-align:center;">🗑️</div>
        <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;text-align:center;">
          ${data.familyName} is scheduled for deletion
        </h2>
        <p style="margin:0 0 16px;color:#64748b;font-size:16px;">
          Hi ${data.parentFirstName}, ${data.requestedByName} asked us to delete your TaskBuddy
          family account. Nothing has been deleted yet.
        </p>
        <p style="margin:0 0 16px;color:#64748b;font-size:16px;">
          Your family's data will be permanently erased on
          <strong style="color:#1e293b;">${formatDate(data.purgeDate)}</strong>. That includes every
          child profile, every photo they uploaded, and all tasks, points and rewards. After that
          date it cannot be recovered, by you or by us.
        </p>
        <p style="margin:0 0 16px;color:#64748b;font-size:16px;">
          Children cannot sign in during this period. Parents still can, which is how you stop it.
        </p>
        <div style="margin:24px 0;padding:16px 20px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px;">
          <p style="margin:0;color:#7f1d1d;font-size:15px;">
            <strong>Changed your mind?</strong> Sign in and go to
            <strong>Settings &rarr; Delete account &rarr; Keep my account</strong> any time in the
            next ${data.graceDays} days. Everything carries on exactly as it was.
          </p>
        </div>
        <p style="margin:16px 0 0;color:#94a3b8;font-size:13px;">
          If you did not expect this, cancel it now and change your password. Questions go to
          privacy@gettaskbuddy.com.
        </p>
      </td>
    </tr>
  `;
}
