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
const buildConfig = buildConfigUntyped as unknown as (ctx: { config: Record<string, unknown> }) => {
  icon: string;
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

describe('splash-icon.png', () => {
  // Contradicts the naive assumption that every adaptive-icon-shaped asset in assets/ is wired into
  // app.config.ts: this repo has no `splash` key in the Expo config at all (no splash screen is
  // configured), so splash-icon.png is not referenced by app.config.ts today. Asserting that it IS
  // referenced would make this test fail against current, correct behaviour. If a splash screen is
  // added later, extend the assertions above rather than resurrecting this file's old shape.
  it('is present on disk even though app.config.ts does not currently reference it', () => {
    const absolute = join(MOBILE_ROOT, 'assets', 'splash-icon.png');
    expect(existsSync(absolute)).toBe(true);
  });
});
