/**
 * Guards the app icon wiring in `app.config.ts`.
 *
 * Two failure modes this exists to catch, both invisible until a device is actually holding the
 * phone:
 *
 *  1. A renamed or deleted asset file. Expo does not fail the build when `foregroundImage` (etc.)
 *     points at a path that does not exist — it just ships an icon with a blank or missing layer,
 *     and the first anyone hears about it is a screenshot of an empty launcher icon during Play
 *     review or from a tester. `fs.statSync` below is the cheap place to catch that: at test time,
 *     not at "someone happened to look at their home screen".
 *  2. The adaptive-icon background reverting to the Expo template's default blue. This app shipped
 *     with that default once — see the comment in `app.config.ts` next to `backgroundColor`. Because
 *     the foreground layer is transparent, that colour is what actually shows through the launcher
 *     mask, so a regression here silently frames the logo in the wrong colour on every Android
 *     device that installs the app.
 *
 * `app.config.ts` exports a function of `({ config }) => ExpoConfig` (dynamic config, not static
 * `app.json`, because the API URL differs between a dev build and a store build). It is invoked here
 * with a minimal fake `ConfigContext` to get the resolved object, the same way `expo-cli` calls it.
 */
import { existsSync, statSync } from 'fs';
import { join } from 'path';

import { palette } from '@taskbuddy/shared';

import buildConfigUntyped from '../../app.config';

// app.config.ts imports `ExpoConfig`/`ConfigContext` only as types (for its exported function's
// signature), which jest's babel transform strips — so a plain static import works here, unlike the
// `.env`-dependent modules in lib/__tests__/config.test.ts that need `require` for `resetModules()`.
/**
 * Only the fields these tests actually read are declared. A plugin entry is either a bare name or a
 * `[name, options]` tuple, and the options bag is intentionally loose: it is plugin-defined config,
 * not something this repo owns a type for, so pinning a shape here would be inventing a contract.
 */
type PluginEntry = string | [string, Record<string, unknown>];

const buildConfig = buildConfigUntyped as unknown as (ctx: { config: Record<string, unknown> }) => {
  icon: string;
  userInterfaceStyle: string;
  plugins?: PluginEntry[];
  android: {
    adaptiveIcon: {
      backgroundColor: string;
      foregroundImage: string;
      backgroundImage: string;
      monochromeImage: string;
    };
  };
};

// mobile/ — every path in app.config.ts is written relative to here, not to this test file.
const MOBILE_ROOT = join(__dirname, '..', '..');

function resolved() {
  return buildConfig({ config: {} });
}

describe('app icon assets', () => {
  it('references ./assets/icon.png as the top-level app icon', () => {
    expect(resolved().icon).toBe('./assets/icon.png');
  });

  it('references all three adaptive-icon layers', () => {
    const { adaptiveIcon } = resolved().android;
    expect(adaptiveIcon.foregroundImage).toBe('./assets/android-icon-foreground.png');
    expect(adaptiveIcon.backgroundImage).toBe('./assets/android-icon-background.png');
    expect(adaptiveIcon.monochromeImage).toBe('./assets/android-icon-monochrome.png');
  });

  it('every referenced asset path exists on disk and is non-empty', () => {
    const config = resolved();
    const referenced = [
      config.icon,
      config.android.adaptiveIcon.foregroundImage,
      config.android.adaptiveIcon.backgroundImage,
      config.android.adaptiveIcon.monochromeImage,
    ];

    for (const relative of referenced) {
      const absolute = join(MOBILE_ROOT, relative);
      expect(existsSync(absolute)).toBe(true);
      // A 0-byte file exists but renders nothing — the same blank-icon symptom as a missing one.
      expect(statSync(absolute).size).toBeGreaterThan(0);
    }
  });

  it('tints the adaptive-icon background with the brand teal, not the Expo template blue', () => {
    // primary-50 (#f0fafc), the lightest step of the brand teal ramp — see the comment in
    // app.config.ts next to this field for why: the foreground layer is transparent, so this colour
    // is what the Android launcher mask actually shows through.
    expect(resolved().android.adaptiveIcon.backgroundColor).toBe(palette.primary[50]);
    expect(palette.primary[50]).toBe('#f0fafc');
  });
});

/**
 * The splash screen.
 *
 * This block previously asserted the OPPOSITE — that `splash-icon.png` existed on disk while being
 * referenced by nothing — because for a long time it was. There was no splash configuration at all,
 * so the app opened on a blank default screen. That is now fixed, and these assertions exist so it
 * cannot regress to "the asset is present, therefore it must be wired", which is exactly the
 * inference that let the gap survive review.
 */
describe('splash screen', () => {
  const splashPlugin = () => {
    const entry = (resolved().plugins ?? []).find(
      (p): p is [string, Record<string, unknown>] =>
        Array.isArray(p) && p[0] === 'expo-splash-screen',
    );
    return entry?.[1];
  };

  it('is configured at all — the whole point of this block', () => {
    expect(splashPlugin()).toBeDefined();
  });

  it('points at an image that exists on disk and is not empty', () => {
    const image = splashPlugin()!.image as string;
    const absolute = join(MOBILE_ROOT, image.replace(/^\.\//, ''));

    expect(existsSync(absolute)).toBe(true);
    expect(statSync(absolute).size).toBeGreaterThan(0);
  });

  it('uses the brand teal, matching the adaptive icon background', () => {
    // Continuity: the launcher icon and the screen it opens into must be the same colour, or the
    // launch reads as two unrelated surfaces.
    expect(splashPlugin()!.backgroundColor).toBe(palette.primary[50]);
  });

  it('has a dark variant, because userInterfaceStyle is automatic', () => {
    // Without this a dark-mode phone gets a bright flash before the themed UI paints — the exact
    // transition a splash screen is supposed to prevent.
    const dark = splashPlugin()!.dark as { backgroundColor?: string } | undefined;

    expect(resolved().userInterfaceStyle).toBe('automatic');
    expect(dark?.backgroundColor).toBe(palette.slate[900]);
  });
});
