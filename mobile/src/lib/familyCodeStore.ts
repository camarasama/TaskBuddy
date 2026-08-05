/**
 * The family code a child's device remembers after scanning their parent's QR.
 *
 * ## The payload format, and why it is not a bare code
 *
 * The QR carries `taskbuddy://join?code=ABC123`, not `ABC123`. Three reasons:
 *
 * 1. **A scanner points at whatever is in frame.** A cereal box, a bus timetable, a friend's WiFi
 *    sticker — all decode to *something*. A bare code would accept any of them and then fail at login
 *    with "wrong family code", which sends the child back to a QR that was never the problem. Requiring
 *    the scheme means anything else is rejected instantly with "that isn't a TaskBuddy code".
 * 2. `taskbuddy://` is already the app's `scheme` in `app.config.ts`, so the same string works as a deep
 *    link later without inventing a second format.
 * 3. It leaves room for another parameter without breaking devices that only know about `code`.
 *
 * ## What storing it does and does not achieve
 *
 * The stored code is never displayed, so the child's login screen is username + PIN and a child cannot
 * read the family code off their own phone to share it. Worth being precise about the limit of that: it
 * is a **convenience and friction measure, not a secret**. `GET /families/me` returns `familyCode` to
 * any authenticated family member including children, so a signed-in child could always obtain it
 * another way. This makes casual sharing harder; it does not make the code confidential, and nothing
 * should be built on the assumption that it does.
 *
 * SecureStore rather than AsyncStorage for consistency with the refresh token, not because the code is
 * as sensitive — it is one of the two halves of a login, so it belongs with the credentials.
 */
import * as SecureStore from 'expo-secure-store';

import { reportError } from './reporting';

/** Namespaced alongside `taskbuddy.refreshToken`; SecureStore keys allow only `[A-Za-z0-9.\-_]`. */
const FAMILY_CODE_KEY = 'taskbuddy.familyCode';

const SCHEME = 'taskbuddy://join';

/** Build the string a parent's QR encodes. */
export function buildJoinLink(familyCode: string): string {
  return `${SCHEME}?code=${encodeURIComponent(familyCode.trim().toUpperCase())}`;
}

/**
 * Pull the family code out of a scanned string, or null if it is not one of ours.
 *
 * Deliberately strict. Returning null for anything unrecognised is what lets the scanner say "that
 * isn't a TaskBuddy code" instead of storing a bus timetable and failing at login.
 */
export function parseJoinLink(scanned: string): string | null {
  const trimmed = scanned.trim();
  if (!trimmed.toLowerCase().startsWith(`${SCHEME}?`)) return null;

  const query = trimmed.slice(SCHEME.length + 1);
  for (const pair of query.split('&')) {
    const [key, rawValue] = pair.split('=');
    if (key !== 'code' || rawValue === undefined) continue;

    let value: string;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      // A malformed percent-escape throws rather than returning something odd. Treated as not-ours.
      return null;
    }

    const code = value.trim().toUpperCase();
    // A code that decodes to nothing is not a code. Without this the child's login screen would hide
    // its family-code field having stored an empty string, leaving no way to sign in at all.
    return code.length > 0 ? code : null;
  }

  return null;
}

/**
 * Every read below degrades to "nothing stored" on failure rather than throwing, for the same reason
 * `tokenStore` does: an unreadable keystore and an un-onboarded device lead to the same screen, and
 * throwing from here would take the app down before there is anywhere to show the error.
 */
export async function getStoredFamilyCode(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(FAMILY_CODE_KEY);
  } catch (cause) {
    reportError(cause, 'familyCodeStore.read');
    return null;
  }
}

/** Remember the code, or forget it when passed null. Returns whether the write landed. */
export async function setStoredFamilyCode(code: string | null): Promise<boolean> {
  try {
    if (code === null) {
      await SecureStore.deleteItemAsync(FAMILY_CODE_KEY);
    } else {
      await SecureStore.setItemAsync(FAMILY_CODE_KEY, code.trim().toUpperCase());
    }
    return true;
  } catch (cause) {
    reportError(cause, 'familyCodeStore.write');
    return false;
  }
}
