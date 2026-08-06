/**
 * emails/testerReminder.ts
 * Nudges a tester who has gone quiet during the closed test.
 * triggerType: 'tester_reminder'
 * templateData: { firstName, optInUrl, appName, hasSignedIn, daysRemaining }
 *
 * ## The message changes depending on where they actually got stuck
 *
 * Two very different people receive this, and sending them the same text wastes the one nudge you
 * get. Someone who never opted in needs the link again and needs to know the link is the whole
 * problem. Someone who opted in and installed the app but stopped opening it needs to know that
 * *opening it* is what counts. `hasSignedIn` picks between them, from whether their roster entry has
 * ever matched a real account.
 *
 * ## No guilt, and no deadline theatre
 *
 * These are friends and family doing a favour. `daysRemaining` is stated once as a fact because it
 * is genuinely useful information, not to apply pressure — the 14-day clock resets rather than
 * expires, so nothing is actually lost if they are slow.
 */

import { baseLayout, ctaButton } from './base';

export interface TesterReminderData {
  firstName: string;
  optInUrl: string;
  appName: string;
  /** True when this tester's email has matched a real account — i.e. they got past opting in. */
  hasSignedIn: boolean;
  /** Days still needed on the 14-day clock, or null when it is not being counted yet. */
  daysRemaining: number | null;
}

export function buildTesterReminder(data: TesterReminderData): string {
  const { firstName, optInUrl, appName, hasSignedIn, daysRemaining } = data;

  const body = hasSignedIn
    ? `
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        Hi ${firstName} — you're all set up on ${appName}, thank you. The only thing left is to
        <strong>open the app now and then</strong> over the next couple of weeks.
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:16px;line-height:1.6;">
        Even a minute counts. Add a task, tick something off, have a look at the rewards — anything at
        all is more useful than a perfect review at the end.
      </p>
      `
    : `
      <p style="margin:0 0 16px;color:#475569;font-size:16px;line-height:1.6;">
        Hi ${firstName} — it looks like the enrolment step hasn't gone through yet, which is easy to
        miss because it happens on Google's site rather than in the app.
      </p>
      <p style="margin:0 0 24px;color:#475569;font-size:16px;line-height:1.6;">
        Tapping the button below and accepting is the bit that actually counts. It takes about
        thirty seconds, and until it's done the app won't appear for you on the Play Store.
      </p>
      `;

  const timing =
    daysRemaining === null
      ? ''
      : `
      <p style="margin:24px 0 0;color:#64748b;font-size:14px;line-height:1.6;">
        For context: Google needs about ${daysRemaining} more ${daysRemaining === 1 ? 'day' : 'days'}
        of people using it before ${appName} can be released properly. No rush on any particular day —
        it's the stretch that matters.
      </p>
      `;

  const inner = `
  <tr>
    <td style="padding:40px 40px 24px;">
      <h2 style="margin:0 0 16px;color:#1e293b;font-size:22px;font-weight:700;">
        ${hasSignedIn ? `A quick nudge 👋` : `Nearly there — one step left`}
      </h2>
      ${body}
      ${ctaButton(hasSignedIn ? 'Open the test' : 'Finish joining the test', optInUrl)}
      ${timing}
      <p style="margin:16px 0 0;color:#64748b;font-size:14px;line-height:1.6;">
        If you'd rather not carry on, just say — no hard feelings at all.
      </p>
    </td>
  </tr>
  `;

  return baseLayout(inner);
}
