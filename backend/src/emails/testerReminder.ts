/**
 * emails/testerReminder.ts
 * Nudges a tester who has gone quiet during the closed test.
 * triggerType: 'tester_reminder'
 * templateData: { firstName, email, optInUrl, appName, hasSignedIn, daysRemaining }
 *
 * ## The message changes depending on where they actually got stuck
 *
 * Two very different people receive this, and sending them the same text wastes the one nudge you
 * get. Someone who never got in needs the link again plus the reason it did not work the first time.
 * Someone who installed the app but stopped opening it needs to know that *opening it* is what
 * counts. `hasSignedIn` picks between them, from whether their roster entry has ever matched a real
 * account.
 *
 * For the first group the reason is almost always the Google account. The track admits testers by
 * email list, so the app is visible only to the exact address on that list; on any other account the
 * listing reports the app as unavailable. There is no opt-in page and no accept step to have missed,
 * which is why this email names the address instead of asking them to try the link again.
 *
 * ## No guilt, and no deadline theatre
 *
 * These are friends and family doing a favour. `daysRemaining` is stated once as a fact because it
 * is genuinely useful information, not to apply pressure. The 14-day clock resets rather than
 * expires, so nothing is actually lost if they are slow.
 */

import { baseLayout, ctaButton } from './base';

export interface TesterReminderData {
  firstName: string;
  /** The address on the Play tester list. Shown to them: it is the one thing they can get wrong. */
  email: string;
  optInUrl: string;
  appName: string;
  /** True when this tester's email has matched a real account, i.e. they got into the app. */
  hasSignedIn: boolean;
  /** Days still needed on the 14-day clock, or null when it is not being counted yet. */
  daysRemaining: number | null;
}

export function buildTesterReminder(data: TesterReminderData): string {
  const { firstName, email, optInUrl, appName, hasSignedIn, daysRemaining } = data;

  const body = hasSignedIn
    ? `
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        Hi ${firstName}, you're all set up on ${appName}, thank you. The only thing left is to
        <strong>open the app now and then</strong> over the next couple of weeks.
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:16px;line-height:1.6;">
        Even a minute counts. Add a task, tick something off, have a look at the rewards. Anything at
        all is more useful than a perfect review at the end.
      </p>
      `
    : `
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        Hi ${firstName}, it looks like you haven't managed to get into ${appName} yet. Nine times out
        of ten it's the Google account: the test is tied to <strong>${email}</strong>, so the app is
        only visible on a phone signed in to Google with that exact address. On any other account the
        page just says the app isn't available.
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:16px;line-height:1.6;">
        If that was it, the link below should work now. There's no separate step to accept or
        confirm: if you can see the app and install it, you're in.
      </p>
      `;

  const timing =
    daysRemaining === null
      ? ''
      : `
      <p style="margin:24px 0 0;color:#64748b;font-size:14px;line-height:1.6;">
        For context: Google needs about ${daysRemaining} more ${daysRemaining === 1 ? 'day' : 'days'}
        of people using it before ${appName} can be released properly. No rush on any particular day:
        it's the stretch that matters.
      </p>
      `;

  const inner = `
  <tr>
    <td style="padding:40px 40px 24px;">
      <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:700;">
        ${hasSignedIn ? `A quick nudge 👋` : `Nearly there, one step left`}
      </h2>
      ${body}
      ${ctaButton(hasSignedIn ? 'Open the test' : 'Get the app', optInUrl)}
      ${timing}
      <p style="margin:16px 0 0;color:#64748b;font-size:14px;line-height:1.6;">
        If you'd rather not carry on, just say. No hard feelings at all.
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
