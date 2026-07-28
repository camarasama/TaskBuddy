/**
 * Build-time config, read once from the Expo manifest.
 *
 * There is no `process.env` on a device — anything the app needs at runtime has to come through
 * `app.config.ts`'s `extra` block, which `expo-constants` surfaces here. Reading it in one place
 * means a missing value fails loudly at startup instead of surfacing as `undefined` inside a
 * fetch URL three screens later.
 */
import Constants from 'expo-constants';

interface Extra {
  apiUrl: string;
  clientPlatform: string;
  clientVersion: string;
}

const extra = Constants.expoConfig?.extra as Partial<Extra> | undefined;

function required<K extends keyof Extra>(key: K): Extra[K] {
  const value = extra?.[key];
  if (!value) {
    throw new Error(
      `Missing "${key}" in app.config.ts → extra. The app cannot start without it.`
    );
  }
  return value;
}

export const API_URL = required('apiUrl');
export const CLIENT_PLATFORM = required('clientPlatform');
export const CLIENT_VERSION = required('clientVersion');

/**
 * The `X-Client` header value. The backend parses this to decide two things: that this client
 * gets its refresh token in the response body rather than a cookie (P0-1), and whether this build
 * is old enough to be force-upgraded (P0-2).
 *
 * The grammar is strict — `<platform>/<major.minor.patch>` — and a malformed value is silently
 * treated as a browser, which would break session persistence in a way that only shows up when
 * the app is restarted. See backend/src/utils/client.ts.
 */
export const CLIENT_HEADER = `${CLIENT_PLATFORM}/${CLIENT_VERSION}`;
