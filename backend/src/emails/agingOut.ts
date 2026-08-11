/**
 * emails/agingOut.ts — a child on the account has turned 18.
 * triggerType: 'aging_out'
 * templateData: { childFirstName, pointsBalance, deadlineDays }
 *
 * States a deadline and what happens if it passes, because the default is irreversible: unclaimed
 * points are discarded. An email that said only "come and have a look" would let a parent lose the
 * window without ever knowing there was one.
 *
 * No CTA button to a public link. The decision needs a signed-in parent, so the email points at the
 * app rather than carrying a token — there is nothing here worth the risk of a link that acts.
 */
import { baseLayout } from './base';

export interface AgingOutData {
  childFirstName: string;
  pointsBalance: number;
  deadlineDays: number;
}

export function buildAgingOut(data: AgingOutData): string {
  const { childFirstName, pointsBalance, deadlineDays } = data;

  const inner = `
  <tr>
    <td style="padding:40px 40px 24px;">
      <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:700;">
        ${childFirstName} has turned 18
      </h2>
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        TaskBuddy is built for children aged 10 to 16, so ${childFirstName}'s account needs a
        decision from you. Nothing has changed for them yet and they can keep using the app in the
        meantime.
      </p>
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        They have <strong>${pointsBalance} points</strong> unspent. Open TaskBuddy and you can:
      </p>
      <ul style="margin:0 0 24px;padding-left:20px;color:#475569;font-size:16px;line-height:1.8;">
        <li>Pass the points to a younger brother or sister</li>
        <li>Clear the points as part of closing the account</li>
        <li>Invite ${childFirstName} back as a co-parent, if they are helping to run the family</li>
      </ul>
      <p style="margin:0 0 8px;color:#475569;font-size:16px;line-height:1.6;">
        If you have not chosen within <strong>${deadlineDays} days</strong>, the points are cleared
        automatically and the account is converted. That step cannot be undone, so it is worth a
        minute now.
      </p>
    </td>
  </tr>
  `;

  return baseLayout(inner);
}
