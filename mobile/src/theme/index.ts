/**
 * Native side of the design tokens (§3.1).
 *
 * The tokens themselves are platform-neutral data in `shared/src/design/tokens.ts`. This module is
 * the small amount of React that turns them into something a screen can use: it picks the light or
 * dark set from the OS setting and hands back the semantic roles.
 *
 * Screens should read colours from here rather than importing `themes` directly, so that honouring
 * the system appearance is the default rather than something each screen remembers to do.
 */
import { useColorScheme } from 'react-native';
import { type SemanticTheme, themes } from '@taskbuddy/shared';

export {
  fontFamily,
  fontSize,
  fontWeight,
  minTouchTarget,
  palette,
  radius,
  spacing,
  type FontFamilyKey,
  type FontWeightKey,
  type SemanticTheme,
} from '@taskbuddy/shared';

export { elevation } from './elevation';

/**
 * The active theme for this render.
 *
 * `useColorScheme()` returns null before the OS value is known and on platforms without a setting;
 * light is the documented fallback, and matches the web, whose `.dark` class is absent by default.
 */
export function useTheme(): SemanticTheme {
  return themes[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

/**
 * Fixed white, for text or icons drawn on a fixed brand gradient (an avatar initial, a hero card)
 * that does not follow the light/dark surface swap.
 *
 * `theme.primaryForeground` is the wrong source for this: dark mode deliberately flips it to a dark
 * colour, because dark mode also lightens `primary` itself (500 to 400) to clear contrast against a
 * slate-900 screen, so primary-on-primary text needs to go dark to match. A gradient avatar's fill
 * never lightens the same way, so its initial must stay white in both themes. This reuses the
 * literal already registered as `themes.light.primaryForeground` in tokens.ts rather than typing a
 * new hex code here, which is exactly what the hex-literal guard exists to catch.
 */
export const onGradient = themes.light.primaryForeground;
