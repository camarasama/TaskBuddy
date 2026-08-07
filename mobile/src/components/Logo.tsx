/**
 * The TaskBuddy lockup — the check-mark mark plus the wordmark — for the screens a user reaches
 * before they are signed in.
 *
 * Centralised rather than `require`d per screen for two reasons. The path is the awkward part: the
 * `@/*` alias points at `src/`, so an asset reference from a route file has to climb out of it, and
 * every screen spelling that climb itself is a resolution bug waiting for the first file that moves.
 * Second, whether the image is announced or hidden is an accessibility decision that should be made
 * the same way everywhere — see `decorative` below.
 *
 * The artwork is a single raster at 512x511, so the height is derived from the requested width
 * rather than passed in; a caller that sets both eventually sets them inconsistently and squashes
 * the mark. `contain` is belt-and-braces for the half-pixel the ratio rounds away.
 */
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';

import { spacing } from '@/theme';

// Resolved at module scope so Metro registers the asset once, not per render.
const SOURCE = require('../../assets/logo-full.png');

/** Intrinsic 512x511. Not square — leaving it square shifts the wordmark's baseline. */
const ASPECT_RATIO = 511 / 512;

interface LogoProps {
  /** Rendered width in dp. Height follows the artwork's ratio. */
  width?: number;
  /**
   * Hide the image from screen readers.
   *
   * Set this on any screen that *also* shows the word "TaskBuddy" as text — the lockup contains the
   * wordmark, so announcing both makes a reader say the product name twice before it reaches
   * anything actionable. Everywhere else the image carries the name and must stay announced.
   */
  decorative?: boolean;
  style?: ViewStyle;
}

export function Logo({ width = 144, decorative = false, style }: LogoProps) {
  return (
    <View style={[styles.wrap, style]}>
      <Image
        source={SOURCE}
        style={[styles.image, { width, height: Math.round(width * ASPECT_RATIO) }]}
        accessible={!decorative}
        accessibilityRole={decorative ? undefined : 'image'}
        accessibilityLabel={decorative ? undefined : 'TaskBuddy'}
        // TalkBack honours this even when `accessible` is false on the element itself.
        importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: spacing[6] },
  image: { resizeMode: 'contain' },
});
