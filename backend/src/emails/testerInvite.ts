/**
 * emails/testerInvite.ts
 * Sent to someone on the closed-test roster, asking them to join the Play test.
 * triggerType: 'tester_invite'
 * templateData: { firstName, optInUrl, appName }
 *
 * ## Two things this email says on purpose
 *
 * **What "opting in" actually requires.** Play's 14-day clock counts days with 12+ testers *opted
 * in*, and the most common failure is someone accepting the invitation, meaning to do it later, and
 * never following the link. So the ask is one concrete action with a visible button, not "have a
 * look when you get a chance".
 *
 * **That their activity is visible to the sender.** The admin roster shows when a tester signed in
 * and what they did. Telling an adult that up front is both the decent thing and the defensible one:
 * quietly monitoring named individuals who agreed to "help test an app" is not what they consented
 * to. One sentence, plainly worded, costs nothing.
 */

import { baseLayout, ctaButton } from './base';

export interface TesterInviteData {
  firstName: string;
  /** The Play opt-in URL for the closed track. */
  optInUrl: string;
  appName: string;
}

export function buildTesterInvite(data: TesterInviteData): string {
  const { firstName, optInUrl, appName } = data;

  const inner = `
  <tr>
    <td style="padding:40px 40px 24px;">
      <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:700;">
        Would you help me test ${appName}? 🙏
      </h2>
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        Hi ${firstName}, thanks for agreeing to help. ${appName} is an app for families to organise
        chores and rewards, and Google needs a group of people to try it before it can go live.
      </p>
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        There are two steps, and the first one matters most:
      </p>
      <ol style="margin:0 0 24px;padding-left:20px;color:#475569;font-size:16px;line-height:1.8;">
        <li><strong>Tap the button below and accept</strong> — this is what actually enrols you.
            Without it nothing else counts.</li>
        <li><strong>Install the app and open it now and then</strong> over the next couple of weeks.</li>
      </ol>

      ${ctaButton('Join the test', optInUrl)}

      <p style="margin:24px 0 0;color:#64748b;font-size:14px;line-height:1.6;">
        You'll need to be signed in to the Google account you use on your Android phone.
      </p>
      <p style="margin:16px 0 0;color:#64748b;font-size:14px;line-height:1.6;">
        So I can tell the test is working, I can see when you sign in and roughly what you do in the
        app. Nothing you do is shared with anyone else, and you can stop at any time — just tell me.
      </p>
    </td>
  </tr>
  `;

  return baseLayout(inner);
}
