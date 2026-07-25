/**
 * emails/parentalConsent.ts — COPPA verifiable parental consent (growth roadmap §3.2).
 * triggerType: 'parental_consent'
 *
 * Carries BOTH halves of the email-plus method, switched on `isConfirmation`:
 *   1. the verification link, and
 *   2. the follow-up notice sent after the link is used.
 *
 * The second is not a courtesy — it is what makes this email-PLUS rather than plain email consent
 * under the FTC rule. A child who reached a parent's inbox cannot complete consent without leaving
 * the parent a visible record that it happened.
 */

import { baseLayout, ctaButton } from './base';

export interface ParentalConsentData {
  parentFirstName: string;
  confirmUrl?: string;
  expiryDays?: number;
  isConfirmation: boolean;
}

export function buildParentalConsent(data: ParentalConsentData): string {
  const { parentFirstName, confirmUrl, expiryDays = 7, isConfirmation } = data;

  if (isConfirmation) {
    const inner = `
  <tr>
    <td style="padding:36px 40px;">
      <h2 style="margin:0 0 12px;color:#0f172a;font-size:20px;font-weight:700;">
        Parental consent recorded
      </h2>
      <p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${parentFirstName}, we have recorded your consent to create and manage child accounts on
        TaskBuddy. You can now add your children.
      </p>
      <p style="margin:0;color:#64748b;font-size:14px;line-height:1.6;">
        <strong>If this wasn't you</strong>, reply to this email straight away — consent can be
        withdrawn and any child account removed on request.
      </p>
    </td>
  </tr>`;
    return baseLayout(inner, 'Parental consent recorded on your TaskBuddy account');
  }

  const inner = `
  <tr>
    <td style="padding:36px 40px 8px;">
      <h2 style="margin:0 0 12px;color:#0f172a;font-size:20px;font-weight:700;">
        Confirm you are the parent
      </h2>
      <p style="margin:0 0 12px;color:#475569;font-size:15px;line-height:1.6;">
        Hi ${parentFirstName}, before TaskBuddy can create an account for your child, we need you to
        confirm that you are their parent or legal guardian.
      </p>
      <p style="margin:0 0 4px;color:#475569;font-size:15px;line-height:1.6;">
        By confirming you agree that we may collect and use your child's information as described in
        our Privacy Policy, only to run TaskBuddy. We do not sell it or share it with advertisers.
      </p>
    </td>
  </tr>
  <tr>
    <td style="padding:8px 40px 0;text-align:center;">
      ${ctaButton('I confirm I am the parent', confirmUrl ?? '#')}
    </td>
  </tr>
  <tr>
    <td style="padding:8px 40px 36px;">
      <p style="margin:0;color:#94a3b8;font-size:13px;line-height:1.6;">
        This link expires in ${expiryDays} days. If you did not request this, ignore this email —
        no child account will be created without your confirmation.
      </p>
    </td>
  </tr>`;

  return baseLayout(inner, 'Confirm you are the parent to finish setting up TaskBuddy');
}
