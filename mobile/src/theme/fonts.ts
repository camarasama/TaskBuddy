/**
 * Font faces, and the reason this is more than a one-liner.
 *
 * ## Android does not synthesise weights for a custom font
 *
 * On the web, `font-family: Inter; font-weight: 600` works because the browser picks the 600 face from
 * the family, or synthesises one. React Native on Android does neither reliably: a custom family maps to
 * exactly the face that was registered under that name, and `fontWeight` on top of it is either ignored
 * or applied as a *second*, faked bold — so semibold text comes out either regular or double-bolded, and
 * which one you get varies by device.
 *
 * The fix is to register each weight as its own family name (`Inter_600SemiBold`) and select the face
 * directly, **without** also setting `fontWeight`. That is what `resolveFont` returns and what
 * `components/AppText.tsx` applies, and it is why nothing should set `fontFamily` by hand.
 *
 * ## Which faces ship
 *
 * Matched to what the web actually uses, not to what the tokens could express:
 *
 *   - **Inter** at 400/500/600/700 — the four weights `fontWeight` in the tokens defines.
 *   - **Poppins at 700 only.** All 93 `font-display` usages in `frontend/src` are paired with
 *     `font-bold` and nothing else, so shipping other Poppins weights would be dead bytes in a bundle
 *     downloaded by families on metered data.
 */
/**
 * Imported from each weight's own subpath, never the package barrel. Two separate reasons, both found the
 * hard way:
 *
 *  1. The barrel `require`s **every** weight it ships — thin through black, plus italics, roughly 18 files
 *     per family. Only five faces are used here.
 *  2. The barrel also does `export * from './useFonts'`, which requires `expo-font`. npm hoisted
 *     `@expo-google-fonts/*` to the repo root while nesting `expo-font` under `mobile/`, so that require
 *     resolves from neither Jest's resolver nor Node's — the walk up from the root package never looks
 *     inside `mobile/node_modules`. The subpath modules require only their own `.ttf` and so sidestep it.
 *
 * The same barrel-versus-subpath trap cost 400KB on `@expo/vector-icons` one step earlier. Worth assuming
 * it applies to any asset-bearing package here.
 */
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';

import { fontWeight, type FontFamilyKey, type FontWeightKey } from '@taskbuddy/shared';

/** Passed to `useFonts()`. Keys are the family names RN will resolve. */
export const FONT_ASSETS = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Poppins_700Bold,
} as const;

type WeightValue = (typeof fontWeight)[FontWeightKey];

/**
 * Concrete face for each (family, weight) pair.
 *
 * `display` deliberately maps every weight to the single Poppins face we ship. A heading asking for
 * medium-weight display type gets bold rather than silently falling back to the system font, which would
 * be the more visible wrong answer.
 */
const FACES: Record<FontFamilyKey, Record<WeightValue, keyof typeof FONT_ASSETS>> = {
  sans: {
    '400': 'Inter_400Regular',
    '500': 'Inter_500Medium',
    '600': 'Inter_600SemiBold',
    '700': 'Inter_700Bold',
  },
  display: {
    '400': 'Poppins_700Bold',
    '500': 'Poppins_700Bold',
    '600': 'Poppins_700Bold',
    '700': 'Poppins_700Bold',
  },
};

/**
 * The face name for a family and weight, or undefined when the weight is not one of ours.
 *
 * Undefined means "leave the system font alone" — better than guessing at a face and getting metrics
 * that do not match the rest of the screen.
 */
export function resolveFont(
  family: FontFamilyKey,
  weight: string | number | undefined
): string | undefined {
  // RN accepts numbers too; the tokens use strings, so normalise before lookup.
  const key = String(weight ?? '400') as WeightValue;
  return FACES[family][key];
}
