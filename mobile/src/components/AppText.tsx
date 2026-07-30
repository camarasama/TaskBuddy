/**
 * Text with the brand font applied.
 *
 * Every screen uses this instead of React Native's `Text`. React Native has no global font setting —
 * there is no equivalent of putting a family on `body` — so without a single wrapper the choice has to be
 * repeated in every style block, and one missed `Text` shows up as a mismatched paragraph.
 *
 * ## What it does that a plain `Text` cannot
 *
 * It reads `fontWeight` out of the incoming style, converts it into a concrete font face
 * (`Inter_600SemiBold`), applies that as `fontFamily`, and then **deletes `fontWeight`**. That last step
 * is the important one: on Android, leaving `fontWeight` set alongside a custom family gets it applied a
 * second time as a synthetic bold, so semibold text renders double-bolded on some devices and normally on
 * others. See the note at the top of `theme/fonts.ts`.
 *
 * The consequence for callers is that existing styles need no edits — they keep declaring
 * `fontWeight: fontWeight.semibold` from the tokens, and this component turns that into the right face.
 */
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { type FontFamilyKey } from '@/theme';
import { resolveFont } from '@/theme/fonts';
import { useFontsReady } from '@/theme/FontProvider';

export interface AppTextProps extends TextProps {
  /**
   * `display` selects Poppins, for headings — matching the web's `font-display`. Defaults to `sans`
   * (Inter), which is body text and the overwhelming majority.
   */
  variant?: FontFamilyKey;
}

export function AppText({ variant = 'sans', style, ...rest }: AppTextProps) {
  const ready = useFontsReady();

  // Flattened so a style array (the common case here — `[styles.x, { color }]`) resolves to one object
  // before its fontWeight is read.
  const flat = StyleSheet.flatten<TextStyle>(style) ?? {};

  /**
   * Until the faces are loaded, render with the system font and the original `fontWeight`. Naming a
   * family that is not registered yet produces either a blank line or a fallback with different metrics,
   * so the honest intermediate state is plain system text at roughly the right weight.
   */
  if (!ready) return <Text {...rest} style={style} />;

  const fontFamily = resolveFont(variant, flat.fontWeight);
  if (!fontFamily) return <Text {...rest} style={style} />;

  // fontWeight removed on purpose — see the note above.
  const { fontWeight: _dropped, ...withoutWeight } = flat;

  return <Text {...rest} style={[withoutWeight, { fontFamily }]} />;
}
