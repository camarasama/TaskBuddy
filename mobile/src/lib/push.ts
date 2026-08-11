/**
 * OS push notifications.
 *
 * ## This is new, not repaired
 *
 * The app had no push at all: `expo-notifications` was not a dependency, nothing requested a
 * permission, and the "Notifications" screens are an in-app feed served by our API. The Android
 * settings toggle appearing disabled was therefore correct behaviour — the app had never declared or
 * asked for the capability.
 *
 * ## Permission is asked at a moment that makes sense, not on launch
 *
 * Requested after sign-in, when the app has already shown what it is for. An app that opens by
 * demanding notifications gets refused, and on Android a refusal is sticky: the user cannot be asked
 * again from inside the app, they have to go to system settings. One badly timed prompt costs the
 * capability permanently, which is why this is not wired into the splash screen.
 *
 * ## Registration is by token, keyed server-side on the token
 *
 * Expo issues one token per install. Re-registering the same token is the same device, so the server
 * upserts rather than inserts; a user with two phones legitimately has two rows.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

import { api } from './api';

/**
 * Android requires a channel before anything can be delivered. Created before the permission is
 * requested, because a notification arriving with no channel is dropped silently by the OS.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'TaskBuddy',
    importance: Notifications.AndroidImportance.DEFAULT,
    // Matches the brand teal used for the app icon background.
    lightColor: '#2b7f91',
  });
}

/**
 * Ask, if we have not already been answered.
 *
 * Returns false rather than throwing when refused. A refusal is an ordinary outcome — the app works
 * without notifications — and a throw here would make every caller wrap it.
 */
export async function requestPushPermission(): Promise<boolean> {
  // A simulator has no push token to issue, and asking produces a confusing failure rather than a
  // useful one.
  if (!Device.isDevice) return false;

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;
  // Do NOT re-ask when the answer is already a permanent no: on Android the second prompt never
  // appears, so this would look like a button that does nothing.
  if (!existing.canAskAgain) return false;

  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/** The EAS project id, which `getExpoPushTokenAsync` needs in a bare/EAS build. */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/**
 * Register this device for push. Safe to call on every sign-in.
 *
 * Returns the token when registration succeeded, null otherwise. Never throws: this runs alongside
 * sign-in, and a push problem must not stop someone getting into the app.
 */
export async function registerForPush(): Promise<string | null> {
  try {
    await ensureAndroidChannel();

    const granted = await requestPushPermission();
    if (!granted) return null;

    const id = projectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
    if (!token) return null;

    await api.post('/notifications/push/expo-token', { token });
    return token;
  } catch {
    return null;
  }
}

/**
 * Drop the token on sign-out.
 *
 * Without this, the next person to sign in on a shared device keeps receiving the previous user's
 * notifications until their token happens to be re-registered — which on a family device is a real
 * disclosure, not a nuisance.
 */
export async function unregisterFromPush(token: string | null): Promise<void> {
  if (!token) return;
  try {
    // POST rather than DELETE: `api.delete` sends no body, and a push token is too long and too
    // punctuation-heavy to want in a URL. A removal endpoint that takes a body is worth the small
    // unRESTfulness.
    await api.post('/notifications/push/expo-token/remove', { token });
  } catch {
    // Best effort. The server also reassigns a token when it is registered by another account.
  }
}
