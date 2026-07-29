/**
 * Session credential storage.
 *
 * Two credentials with deliberately different homes:
 *
 *   - **Access token — memory only.** Short-lived, and never written anywhere persistent. This
 *     matches the web's F-01 policy (no role persists an access token) for the same reason: a
 *     persisted access token is a stealable bearer credential that buys nothing, because it can
 *     always be re-minted from the refresh token.
 *   - **Refresh token — `expo-secure-store`,** which is the Android Keystore / iOS Keychain. This is
 *     the native equivalent of what HttpOnly buys the web: the process can read it, but another app
 *     and an attacker with the filesystem cannot. It is what makes a 90-day mobile session (P0-4)
 *     acceptable rather than merely convenient.
 *
 * Nothing here talks to the network — `api.ts` owns that. This module is only the store, so it can
 * be reasoned about (and tested) without a fetch mock.
 */
import * as SecureStore from 'expo-secure-store';

import { reportError } from './reporting';

/**
 * SecureStore keys accept only alphanumerics, `.`, `-` and `_`. Namespaced so a future credential
 * (a push token, a device id) does not collide.
 */
const REFRESH_TOKEN_KEY = 'taskbuddy.refreshToken';

/** In-memory only, by policy. Cleared by process death, which is correct. */
let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Reasons a keystore operation failed, surfaced rather than swallowed.
 *
 * Every function below degrades to "no stored session" on failure instead of throwing. A keystore
 * that cannot be read is indistinguishable, from the user's point of view, from not being logged in
 * — and the recoverable path (show the login screen) is the same. Throwing from here would instead
 * propagate into app startup, which on React Native means a silent close with nothing on the phone
 * and nothing in the Metro terminal. `config.ts` documents that failure mode at length; the same
 * reasoning applies.
 *
 * Populated for diagnostics so a genuinely broken keystore is visible in Sentry rather than
 * presenting as an inexplicable logout loop.
 */
export const STORE_ERRORS: string[] = [];

function recordFailure(operation: string, cause: unknown): void {
  const detail = cause instanceof Error ? cause.message : String(cause);
  STORE_ERRORS.push(`secure-store ${operation} failed: ${detail}`);
  reportError(cause, `tokenStore.${operation}`);
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch (cause) {
    recordFailure('read', cause);
    return null;
  }
}

/**
 * Persist the refresh token, or delete it when passed null.
 *
 * Returns whether the write actually landed. **Callers must not ignore this on the rotation path.**
 * The server has already spent the previous token by the time this is called (see the note on
 * rotation in `api.ts`), so a failed write means the only copy of the live credential is about to be
 * lost — the session is unrecoverable on the next launch and the user gets an unexplained logout.
 * Better to detect it here and end the session deliberately.
 */
export async function setRefreshToken(token: string | null): Promise<boolean> {
  try {
    if (token === null) {
      await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    } else {
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
    }
    return true;
  } catch (cause) {
    recordFailure(token === null ? 'delete' : 'write', cause);
    return false;
  }
}

/**
 * Drop every trace of the session locally.
 *
 * Local only — it does not revoke anything server-side. Call `authApi.logout()` for that; this is
 * the half that must still run when the server is unreachable, so that "sign out" on a plane
 * actually signs the user out of the device.
 */
export async function clearSession(): Promise<void> {
  setAccessToken(null);
  await setRefreshToken(null);
}

/** True when a refresh token is on the device, i.e. a session is worth attempting to restore. */
export async function hasStoredSession(): Promise<boolean> {
  return (await getRefreshToken()) !== null;
}
