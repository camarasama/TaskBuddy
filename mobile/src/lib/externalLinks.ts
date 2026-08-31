/**
 * The places the app sends a parent when the answer is not inside the app.
 *
 * ## Why these are constants and not typed at the call site
 *
 * Three of these URLs are load-bearing for Play compliance, not convenience links. The Data safety
 * form and the store listing both point at `gettaskbuddy.com/privacy` and `/delete-account`, and a
 * Families-policy review checks that the app itself reaches the same pages. A typo is not a broken
 * link, it is a mismatch between what the listing promises and what the app does, which is the kind
 * of thing that gets a release rejected. They are pinned here, once, next to the marketing build
 * (`marketing/build.mjs`) that generates the pages they point at.
 *
 * ## Why nothing here throws
 *
 * `Linking.openURL` rejects when the device has nothing registered for the scheme: no browser, no
 * mail client, Play absent on a de-Googled ROM. That is a normal state on some Android devices, not
 * an error worth a crash report, so the helpers report failure by returning false and let the screen
 * say so.
 */
import { Linking } from 'react-native';

/** Contact for anything that is not a privacy request. `TERMS.md` names the same address. */
export const SUPPORT_EMAIL = 'support@gettaskbuddy.com';

/** Generated from `PRIVACY.md` by `marketing/build.mjs`. Cited on the Play Data safety form. */
export const PRIVACY_URL = 'https://gettaskbuddy.com/privacy';

/** Generated from `TERMS.md`. */
export const TERMS_URL = 'https://gettaskbuddy.com/terms';

/**
 * Generated from `ACCOUNT_DELETION.md`.
 *
 * Play requires this to stand on its own for someone who has already uninstalled, which is why the
 * app links to the public page rather than reproducing the steps in a screen only a signed-in user
 * can reach.
 */
export const DELETE_ACCOUNT_URL = 'https://gettaskbuddy.com/delete-account';

/**
 * Play listing, most specific first.
 *
 * `market://` hands straight to the Play app, which is where a review actually gets written; the
 * https form is the fallback for a device without Play, where it opens in a browser. Deliberately
 * ordered rather than probed with `canOpenURL`: from Android 11, `canOpenURL` returns false for
 * `market://` unless the package declares a `<queries>` entry for it, so probing would report "no
 * Play Store" on a phone that plainly has one. Attempting the open does not carry that restriction.
 */
export function playListingUrls(applicationId: string): string[] {
  return [
    `market://details?id=${applicationId}`,
    `https://play.google.com/store/apps/details?id=${applicationId}`,
  ];
}

export interface SupportContext {
  /** From `expo-application`; null in Expo Go, where there is no installed package to read. */
  version: string | null;
  build: string | null;
  platform: string;
}

/**
 * A support email with the build already in it.
 *
 * The version is the first thing any report needs and the last thing a user thinks to include, and
 * with a closed test there is no device list to look it up in. Prefilling it turns "it broke" into
 * something answerable. The body is separated by a rule and asks to be left in place, so it reads as
 * diagnostic rather than as text the sender is expected to edit around.
 */
export function supportMailto({ version, build, platform }: SupportContext): string {
  const body = [
    'Tell us what happened, and what you expected instead.',
    '',
    '',
    '---',
    'These lines help us find the problem. Please leave them in place.',
    `App: ${version ?? 'unknown'}${build ? ` (${build})` : ''}`,
    `Platform: ${platform}`,
  ].join('\n');

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    'TaskBuddy support'
  )}&body=${encodeURIComponent(body)}`;
}

/**
 * Open the first URL the device can handle. Returns false when none of them worked.
 *
 * Sequential by design: each entry is a less specific fallback than the one before, so the loop must
 * stop at the first success rather than racing them.
 */
export async function openFirstAvailable(urls: string[]): Promise<boolean> {
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Nothing registered for this scheme. Try the next, and report failure only if all of them fail.
    }
  }
  return false;
}
