/**
 * The bridge between an approval going through and Play's in-app review sheet.
 *
 * The decision itself is in `reviewPolicy.ts`, which imports nothing native. This file owns the two
 * calls that do (`expo-secure-store` and `expo-store-review`) and is imported only by the screen
 * that grants approvals.
 *
 * ## SecureStore for a counter
 *
 * Not because a prompt counter is sensitive, but because it is the only persistence this app has:
 * there is no AsyncStorage here, and adding a native dependency to hold three integers is a worse
 * trade than reusing the store the refresh token already lives in. `familyCodeStore.ts` made the same
 * call for the same reason.
 *
 * ## Why an attempt is recorded even when nothing appears
 *
 * `requestReview()` resolves the same way whether Play showed the sheet, silently swallowed it because
 * the device's quota is spent, or decided this user has already reviewed. There is no signal, by
 * design, because Google does not want apps reacting to it. So the attempt is banked regardless. The
 * alternative is to retry on every future approval, which turns an unspent quota into a prompt that
 * fires the instant it refreshes and keeps doing so, which is the exact behaviour the policy exists to
 * prevent.
 *
 * ## Nothing here can fail an approval
 *
 * Every path is wrapped. A parent approving their child's chore must never see an error, or lose the
 * approval, because a rating prompt could not read a counter.
 */
import * as SecureStore from 'expo-secure-store';
import * as StoreReview from 'expo-store-review';

import { reportError } from './reporting';
import {
  parseReviewState,
  recordApproval,
  recordPrompt,
  shouldPrompt,
  type ReviewState,
} from './reviewPolicy';

/** Namespaced alongside the other SecureStore keys; the allowed set is `[A-Za-z0-9.\-_]`. */
const REVIEW_STATE_KEY = 'taskbuddy.reviewPrompt';

async function save(state: ReviewState): Promise<void> {
  await SecureStore.setItemAsync(REVIEW_STATE_KEY, JSON.stringify(state));
}

/**
 * Count an approval, and ask for a review if this is a reasonable moment to.
 *
 * Call this only after a genuine approval a parent chose to grant. Not after a rejection, which is
 * nobody's good mood, and not after the seeded approval in the setup wizard, which is a demonstration
 * the parent has been walked through rather than evidence the app is working for them.
 */
export async function noteApprovalGranted(now: Date = new Date()): Promise<void> {
  try {
    const stored = parseReviewState(await SecureStore.getItemAsync(REVIEW_STATE_KEY));
    const state = recordApproval(stored);

    if (!shouldPrompt(state, now)) {
      await save(state);
      return;
    }

    // False on a device with no store front end at all. Banking the approval but not the prompt is
    // correct here: nothing was asked, so nothing should be counted against the budget.
    if (!(await StoreReview.isAvailableAsync())) {
      await save(state);
      return;
    }

    await StoreReview.requestReview();
    await save(recordPrompt(state, now));
  } catch (caught) {
    reportError(caught, 'reviewPrompt');
  }
}
