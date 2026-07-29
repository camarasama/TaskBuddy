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
  fontSize,
  fontWeight,
  minTouchTarget,
  palette,
  radius,
  spacing,
  type SemanticTheme,
} from '@taskbuddy/shared';

/**
 * The active theme for this render.
 *
 * `useColorScheme()` returns null before the OS value is known and on platforms without a setting;
 * light is the documented fallback, and matches the web, whose `.dark` class is absent by default.
 */
export function useTheme(): SemanticTheme {
  return themes[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
