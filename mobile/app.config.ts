/**
 * Expo app config. Replaces the template's static app.json because two values have to differ
 * between a dev build and a store build, and JSON cannot express that.
 *
 * `extra` is the only channel from build-time config into app code — read it via
 * `expo-constants`, never `process.env` at runtime (there is no process.env on a device).
 */
import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * The API base MUST be absolute. The web client defaults to the relative `/api/v1`, which is
 * meaningless on a phone — there is no origin to be relative to.
 *
 * In development this points at the VPS rather than localhost on purpose: `localhost` inside the
 * app means the *phone*, not this machine. Pointing a dev build at a local backend needs the
 * machine's LAN IP, so that is opt-in via EXPO_PUBLIC_API_URL rather than a default that fails
 * confusingly.
 */
const PROD_API = 'https://api.gettaskbuddy.com/api/v1';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TaskBuddy',
  slug: 'taskbuddy',
  // The EAS account that owns the project and, more importantly, the signing credentials. Stated
  // explicitly rather than inferred from whoever is logged in, so a build from another machine or
  // from CI cannot quietly resolve to a different account.
  owner: 'camarasama',
  scheme: 'taskbuddy',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  android: {
    // ⚠️ Reverse-DNS of gettaskbuddy.com. This is PERMANENT once the app is uploaded to Play —
    // it is the app's identity there, and changing it later means publishing a different app and
    // losing every install and review. Change it now or never.
    package: 'com.gettaskbuddy.app',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  // `expo-font` is listed because `expo install` asks for it. Fonts are still loaded at runtime via
  // `useFonts()` rather than embedded through the plugin's `fonts` option — runtime loading is what
  // works in Expo Go, which is how the app is being tested until a development build exists.
  plugins: ['expo-router', 'expo-secure-store', 'expo-font'],
  extra: {
    // Written by hand because `eas init` cannot edit a dynamic TypeScript config — it prints the ID
    // and stops. Without this, EAS builds have no project to attach to.
    eas: {
      projectId: '2788418b-e7dd-46b0-9dc9-b812b038308e',
    },
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? PROD_API,
    // Sent as `X-Client: taskbuddy-android/<version>` on every request. The backend keys mobile
    // token delivery off the platform (P0-1) and the force-upgrade gate off the version (P0-2),
    // so this string is load-bearing — see backend/src/utils/client.ts for the exact grammar.
    clientPlatform: 'taskbuddy-android',
    clientVersion: '0.1.0',
  },
});
