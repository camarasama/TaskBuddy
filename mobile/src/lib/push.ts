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
 * Tell expo-notifications to actually SHOW a notification that arrives while the app is open.
 *
 * ⚠️ Without this there is no banner in the foreground, and that is not a bug in the OS — from SDK 53
 * the default is to deliver the notification to the app silently and display nothing. The symptom is
 * exactly what it sounds like: push "not working", when in fact it arrived and was swallowed.
 *
 * Set at module scope so it is registered before any notification can be received, including one
 * that launched the app.
 *
 * `shouldShowBanner`/`shouldShowList` replaced the old `shouldShowAlert` in SDK 53. Both are set:
 * banner is the heads-up display, list is the notification panel entry. Setting only the first gives
 * a banner that vanishes and leaves nothing behind to tap.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

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

/**
 * Route a tapped notification to the screen it is about.
 *
 * The payload carries `actionUrl` in `data` rather than in the title, so this can navigate without
 * parsing prose. Returns an unsubscribe for the caller to run on unmount.
 *
 * Covers the cold-start case too: a notification that launched the app is not delivered to the
 * listener, so `getLastNotificationResponseAsync` is checked once. Without that, tapping a
 * notification while the app is closed opens it on the home screen with no explanation.
 */
export function subscribeToNotificationTaps(navigate: (url: string) => void): () => void {
  const urlFrom = (response: Notifications.NotificationResponse | null): string | null => {
    const data = response?.notification?.request?.content?.data as { actionUrl?: string } | undefined;
    const url = data?.actionUrl;
    return typeof url === 'string' && url.startsWith('/') ? url : null;
  };

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    const url = urlFrom(response);
    if (url) navigate(url);
  });

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = urlFrom(response);
    if (url) navigate(url);
  });

  return () => subscription.remove();
}
