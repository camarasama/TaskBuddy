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
    /**
     * ⚠️ IGNORED while `eas.json` sets `cli.appVersionSource: "remote"` — which it does. EAS keeps
     * the build number on its own servers and increments it per production build; this value is only
     * a fallback for a local `expo run:android`.
     *
     * It used to be `local`, with `autoIncrement: true` on the production profile. That combination
     * **cannot work with a dynamic TypeScript config**: incrementing means writing the new number
     * back into this file, which EAS cannot parse or edit, and it fails the build outright with
     * "autoIncrement option is not supported when using app.config.js". Remote versioning fixes that
     * and also removes the standing trap that every Play upload after the first needed a hand-edited
     * number or Play would reject it as a duplicate.
     *
     * The `version` string above (0.1.0) is still read from here — only the build number moved.
     */
    versionCode: 1,
    adaptiveIcon: {
      // Tinted from the brand teal (primary-50, #f0fafc) rather than the Expo template's blue.
      // The adaptive foreground is transparent, so this is what shows through the launcher's mask —
      // leaving it sky-blue would have framed a teal logo in the old palette.
      backgroundColor: '#f0fafc',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: './assets/favicon.png',
  },
  /**
   * EAS Update (over-the-air JS/asset updates).
   *
   * Why this exists: build queues on this account run 130–200 minutes, and the Play closed test is
   * 14 days long. A JS-only fix published here reaches installed apps in minutes. Anything that
   * touches NATIVE code (a new native module, a config-plugin change, an SDK bump) still requires a
   * real build — an OTA update cannot ship native code.
   *
   * The URL is the standard EAS Update endpoint for this project. The UUID is the same one as
   * `extra.eas.projectId` below and must stay identical to it; the project ID is permanent, so this
   * is a fixed value rather than a drift risk.
   *
   * Defaults left alone deliberately: `checkAutomatically` stays ON_LOAD and
   * `fallbackToCacheTimeout` stays 0, so a cold start never blocks on the network. The app launches
   * the bundle it already has and applies any newly downloaded update on the NEXT launch. That means
   * a published fix reaches a tester on their second app open, which is the right trade — the
   * alternative is a startup that stalls on a bad connection.
   */
  updates: {
    url: 'https://u.expo.dev/2788418b-e7dd-46b0-9dc9-b812b038308e',
  },
  /**
   * ⚠️ The safety interlock for the above. The runtime version identifies the NATIVE side of a
   * build. The client sends it when asking for an update, and the server only hands back updates
   * that declare the same runtime version, so a JS bundle built against different native code is
   * REFUSED rather than downloaded into a binary that cannot run it (which is a hard crash on
   * launch, on a tester's phone, with no way for us to take it back).
   *
   * Policy: `fingerprint`. The runtime version is a hash of the native project, so it moves by
   * itself the moment a native module is added, and no human has to remember anything.
   *
   * ## This reverses an earlier, deliberate choice. The reasoning is worth keeping.
   *
   * It was `appVersion` (the runtime version being the `version` string, "0.1.0") on the grounds
   * that fingerprint only works if the machine PUBLISHING an update computes the same inputs as the
   * machine that BUILT the binary, and this hoisted monorepo has known-unstable inputs (duplicate
   * React, patch drift across expo/expo-constants/expo-linking/expo-router). That concern is real
   * and was demonstrated: a locally computed fingerprint on 2026-08-08 did not match the one EAS
   * recorded for the same commit.
   *
   * What changed is the reading of WHICH failure is worse, not the facts:
   *
   *  - Fingerprint's failure is an update that does not arrive. Annoying, recoverable, and visible:
   *    `eas update` reports when no build matches a runtime version.
   *  - `appVersion`'s failure is a crash loop. `version` had sat at "0.1.0" since the first build
   *    while FOUR native modules landed (expo-file-system, expo-sharing, expo-splash-screen,
   *    expo-linear-gradient), so the interlock it describes was not actually holding: an OTA
   *    referencing any of them would have been served to an older binary and hard-crashed it on
   *    launch. Unrecoverable remotely, on a roster of testers that can only be spent once.
   *
   * A protection that depends on remembering to bump a string is not a protection, and this repo
   * had already forgotten four times.
   *
   * ⚠️ **Changing this orphans every existing install.** The runtime version stops being "0.1.0" and
   * becomes a hash, so binaries built before this commit (including the versionCode 4 `.aab`) can
   * never be sent another OTA. A fresh production build is required, not optional.
   *
   * `version` is unaffected and still ships to the backend as `extra.clientVersion` for the
   * force-upgrade gate (P0-2). The two were only ever coupled by the old policy.
   */
  runtimeVersion: { policy: 'fingerprint' },
  // `expo-font` is listed because `expo install` asks for it. Fonts are still loaded at runtime via
  // `useFonts()` rather than embedded through the plugin's `fonts` option — runtime loading is what
  // works in Expo Go, which is how the app is being tested until a development build exists.
  // `@sentry/react-native` is a native module with a config plugin, which is precisely why it could
  // not be added while the app ran in Expo Go — see the note in src/lib/reporting.ts. It requires a
  // development build, which now exists.
  //
  // Source-map upload (so stack traces name our functions instead of minified symbols) is opt-in
  // via SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN at *build* time. Unset, the build still
  // succeeds — you just get less readable traces, which is a fair default for a token that must not
  // live in the repo.
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    '@sentry/react-native',
    /**
     * The launch screen.
     *
     * Until now there was NO splash configuration at all: `assets/splash-icon.png` sat in the repo
     * referenced by nothing, so the app opened on a blank default screen and the first thing a new
     * tester saw was a white flash rather than the product. It was invisible in review precisely
     * because the asset file existed — the only way to catch it was to resolve the config and look
     * for the key.
     *
     * Colours are written as literals rather than imported from `@taskbuddy/shared`. This file is
     * evaluated by the Expo CLI and by EAS *before* the workspace is necessarily built, so importing
     * from the shared package risks a build that fails on a missing `shared/dist` — a bad trade for
     * avoiding two duplicated strings. `app-config.test.ts` asserts both values still equal their
     * design tokens, so the duplication cannot drift silently.
     *
     * `dark` is set because `userInterfaceStyle` is `automatic`: without it, a dark-mode phone gets
     * a bright #f0fafc flash before the themed UI paints, which is the exact jarring transition a
     * splash screen exists to prevent.
     */
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        // palette.primary[50] — the same brand teal as the adaptive icon background, so the launcher
        // icon and the screen it opens into are continuous rather than two different colours.
        backgroundColor: '#f0fafc',
        imageWidth: 200,
        dark: {
          image: './assets/splash-icon.png',
          // palette.slate[900] === themes.dark.background
          backgroundColor: '#0f172a',
          imageWidth: 200,
        },
      },
    ],
    // QR onboarding: the child's app scans a code the parent shows. The permission string is written
    // here rather than left to the plugin's default because it is shown verbatim in Android's dialog
    // and, for a Families-policy app, a vague reason is a review risk. It names the only use.
    [
      'expo-camera',
      {
        cameraPermission:
          'TaskBuddy uses the camera only to scan the sign-in code your parent shows you.',
        // Explicitly off. The plugin would otherwise declare both, and asking a children's app for the
        // microphone with no feature behind it is exactly what a Families reviewer looks for.
        recordAudioAndroid: false,
      },
    ],
    // Choosing a child's profile picture. Both strings are written out because Android shows them
    // verbatim, and a Families-policy app asking for photo access without naming the reason is a
    // review risk. Note the picker is used ONLY for a parent setting an avatar — children never
    // reach it, which is why the wording says so.
    [
      'expo-image-picker',
      {
        photosPermission:
          'TaskBuddy lets a parent choose a profile picture for their child from this device.',
        cameraPermission:
          'TaskBuddy lets a parent take a profile picture for their child.',
      },
    ],
  ],
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
    // Optional by design, matching backend/src/instrument.ts and the frontend's two instrumentation
    // files: unset DSN means Sentry never initializes — no init, no events, no network. A DSN is a
    // public ingest key, not a secret, but it stays out of the repo so a fork or a local build does
    // not silently post crashes into our project.
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  },
});
