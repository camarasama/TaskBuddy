/**
 * emails/parentalConsentRecorded.ts
 * Sent to every adult on the account when a child is added and consent is ticked.
 * triggerType: 'parental_consent_recorded'
 * templateData: { childFirstName, formVersion, recordedAt }
 *
 * ## This is a receipt, not a request
 *
 * Nothing here asks the reader to do anything, and it deliberately has no call-to-action button.
 * Consent has already been given and recorded by the time this sends. Its job is to leave a copy in
 * the inbox of every parent on the account, including the one who was not holding the phone.
 *
 * That fan-out is the substance of it. One parent can add a child alone, and this is the check on
 * that: a co-parent who did not agree finds out the same day, from a message they did not have to go
 * looking for. Sending it only to the acting parent would make it a self-addressed receipt and worth
 * very little.
 *
 * The version is stated because the wording of what was agreed can change. "You agreed" is not a
 * record; "you agreed to version 1.0 on this date" is.
 */
import { baseLayout } from './base';

export interface ParentalConsentRecordedData {
  childFirstName: string;
  formVersion: string;
  /** ISO timestamp. Rendered in the reader's locale rather than shown raw. */
  recordedAt: string;
}

export function buildParentalConsentRecorded(data: ParentalConsentRecordedData): string {
  const { childFirstName, formVersion, recordedAt } = data;

  const when = (() => {
    const parsed = new Date(recordedAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  })();

  const inner = `
  <tr>
    <td style="padding:40px 40px 24px;">
      <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:700;">
        Parental consent recorded
      </h2>
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        This is a record for your files. An account was created for
        <strong>${childFirstName}</strong> on your family's TaskBuddy${when ? ` on ${when}` : ''},
        and a parent confirmed consent for us to hold their information.
      </p>
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        You are receiving this because you are a parent on this account. Every adult on the account
        gets a copy, whether or not they were the one who added the child.
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:16px;line-height:1.6;">
        There is nothing you need to do. If you did not expect this, reply to this email and we will
        help you sort it out.
      </p>
      <p style="margin:24px 0 0;color:#64748b;font-size:14px;line-height:1.6;">
        Consent statement version ${formVersion}. You can withdraw consent at any time by removing
        the child from your family in Settings, which deletes their account.
      </p>
    </td>
  </tr>
  `;

  return baseLayout(inner);
}
