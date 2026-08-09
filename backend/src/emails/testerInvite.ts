/**
 * emails/testerInvite.ts
 * Sent to someone on the closed-test roster, asking them to join the Play test.
 * triggerType: 'tester_invite'
 * templateData: { firstName, email, optInUrl, appName }
 *
 * ## Two things this email says on purpose
 *
 * **Which Google account to use.** The closed track admits testers by *email list*, not by Google
 * Group, so there is no opt-in page and nothing to accept: access is granted off the Google account
 * itself, and `optInUrl` is the ordinary store listing. That makes the account the whole ballgame.
 * A tester whose phone is signed in to a different address sees "app not available" and reasonably
 * concludes the test is broken, so the address is stated explicitly rather than implied.
 *
 * **That their activity is visible to the sender.** The admin roster shows when a tester signed in
 * and what they did. Telling an adult that up front is both the decent thing and the defensible one:
 * quietly monitoring named individuals who agreed to "help test an app" is not what they consented
 * to. One sentence, plainly worded, costs nothing.
 */

import { baseLayout, ctaButton } from './base';

export interface TesterInviteData {
  firstName: string;
  /** The address on the Play tester list. Shown to them: it is the one thing they can get wrong. */
  email: string;
  /** The Play opt-in URL for the closed track. */
  optInUrl: string;
  appName: string;
}

export function buildTesterInvite(data: TesterInviteData): string {
  const { firstName, email, optInUrl, appName } = data;

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
        There is one thing to get right, and the rest is easy:
      </p>
      <ol style="margin:0 0 24px;padding-left:20px;color:#475569;font-size:16px;line-height:1.8;">
        <li><strong>Open the link below on your Android phone</strong>, signed in to Google as
            <strong>${email}</strong>. That is the address I put on the test list, and the app is
            only visible to it. On any other Google account the page will say the app isn't
            available, which means the account is wrong, not that something is broken.</li>
        <li><strong>Install it, then open it now and then</strong> over the next couple of weeks.</li>
      </ol>

      ${ctaButton('Get the app', optInUrl)}

      <p style="margin:24px 0 0;color:#64748b;font-size:14px;line-height:1.6;">
        There is nothing to accept or confirm along the way. If you can see the app and install it,
        you're in.
      </p>
      <p style="margin:16px 0 0;color:#64748b;font-size:14px;line-height:1.6;">
        So I can tell the test is working, I can see when you sign in and roughly what you do in the
        app. Nothing you do is shared with anyone else, and you can stop at any time, just tell me.
      </p>
    </td>
  </tr>
  `;

  return baseLayout(
    inner,
    '',
    `You're receiving this because you agreed to help test ${appName}.<br>
     Reply to this email and I'll take you off the list.`,
  );
}
