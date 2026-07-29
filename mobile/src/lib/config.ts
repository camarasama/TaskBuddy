/**
 * Build-time config, read once from the Expo manifest.
 *
 * There is no `process.env` on a device — anything the app needs at runtime comes through
 * `app.config.ts`'s `extra` block, which `expo-constants` surfaces here.
 *
 * This module deliberately does NOT throw at import time, though an earlier version did. Throwing
 * during module evaluation in React Native kills the app before any error boundary or LogBox
 * exists to catch it: on a device it closes and returns to the Expo Go home screen with no message
 * anywhere — on the phone or in the Metro terminal. "Fails loudly" on a server means a stack trace
 * in the logs; on a phone it means a silent disappearance, which is the opposite of loud.
 *
 * So missing values degrade to a placeholder and are reported through `CONFIG_ERRORS`, which the
 * UI renders. A wrong config should be visible, not fatal.
 */
import Constants from 'expo-constants';

interface Extra {
  apiUrl: string;
  clientPlatform: string;
  clientVersion: string;
}

const extra = Constants.expoConfig?.extra as Partial<Extra> | undefined;

/** Populated at import; rendered by the UI. Empty means config is sound. */
export const CONFIG_ERRORS: string[] = [];

function read<K extends keyof Extra>(key: K, fallback: string): string {
  const value = extra?.[key];
  if (typeof value !== 'string' || value.length === 0) {
    CONFIG_ERRORS.push(`Missing "${key}" in app.config.ts → extra`);
    return fallback;
  }
  return value;
}

if (!Constants.expoConfig) {
  CONFIG_ERRORS.push('Constants.expoConfig is null — the Expo manifest did not load');
}

export const API_URL = read('apiUrl', 'https://unconfigured.invalid/api/v1');
export const CLIENT_PLATFORM = read('clientPlatform', 'unknown');
export const CLIENT_VERSION = read('clientVersion', '0.0.0');

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
