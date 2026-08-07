/**
 * emails/childPinReset.ts
 * Sent to every parent in the family when their child requests a PIN reset from the login screen
 * (child-initiated, unauthenticated — see AuthService.requestChildPinReset). Never sent to the
 * child: the whole point is that they are locked out and need an adult to finish the reset.
 * triggerType: 'child_pin_reset_requested'
 * templateData: { childFirstName, resetUrl, expiryHours }
 */

import { baseLayout, ctaButton } from './base';

export interface ChildPinResetData {
  childFirstName: string;
  /** Web-only — points at the FRONTEND_URL app, same base URL the parent password-reset email uses. */
  resetUrl: string;
  expiryHours: number;
}

export function buildChildPinReset(data: ChildPinResetData): string {
  const { childFirstName, resetUrl, expiryHours } = data;

  const inner = `
  <tr>
    <td style="padding:32px 40px 24px;text-align:center;">
      <div style="font-size:48px;margin-bottom:16px;">🔒</div>
      <h2 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#1e293b;">
        ${childFirstName} forgot their PIN
      </h2>
      <p style="margin:0 0 24px;color:#64748b;font-size:16px;">
        ${childFirstName} just asked to reset their TaskBuddy PIN from the sign-in screen. Tap the
        button below to choose a new one for them. This link expires in ${expiryHours} hour${expiryHours === 1 ? '' : 's'}.
      </p>
      ${ctaButton('Set a new PIN', resetUrl)}
      <p style="margin:24px 0 0;color:#94a3b8;font-size:13px;">
        If ${childFirstName} didn't ask for this, you can safely ignore this email — their PIN will
        not change unless someone opens this link.
      </p>
    </td>
  </tr>
  `;

  return baseLayout(inner);
}
