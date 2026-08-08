/**
 * Elevation: iOS shadow and Android elevation, together.
 *
 * React Native needs both, and they are not interchangeable. `shadowColor` / `shadowOpacity` /
 * `shadowRadius` / `shadowOffset` are iOS-only: Android ignores them completely and reads
 * `elevation` instead. A style that sets only the shadow properties renders a shadow in the
 * simulator and is flat on every physical Android device, which is the entire test fleet for this
 * app. Both sets have to be present on the same style object for a card to look the same on both
 * platforms.
 *
 * Two levels, matching the redesign spec: `card` for list surfaces, `lift` for the hero, wallet and
 * primary CTA. The spec pins the Android `elevation` numbers (2 and 6) but leaves the iOS shadow
 * geometry unspecified; the values below scale the shadow opacity and blur with elevation so the
 * two platforms read as the same weight of lift rather than matching a number with no visual
 * reference.
 */
import { palette } from '@taskbuddy/shared';
import type { ViewStyle } from 'react-native';

type ElevationStyle = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOpacity' | 'shadowRadius' | 'shadowOffset' | 'elevation'
>;

export const elevation: Record<'card' | 'lift', ElevationStyle> = {
  card: {
    shadowColor: palette.slate[900],
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  lift: {
    shadowColor: palette.slate[900],
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
};
