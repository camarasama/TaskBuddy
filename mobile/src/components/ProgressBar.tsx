/**
 * A gradient progress meter: XP toward a level, points saved toward a goal, or tasks completed.
 *
 * One component with a `variant` rather than three, because the only thing that differs between
 * them is which two palette steps the fill gradient reads from: track, height, rounding and the
 * clamp are identical regardless of what is being measured.
 *
 * `percent` is treated as untrusted input on purpose: it is usually a server-computed ratio (points
 * saved / goal cost, XP earned / XP to next level), and a goal edited to zero or a levelling bug
 * upstream should not be able to render a bar wider than its track or a negative-width crash.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { palette, radius, useTheme } from '@/theme';

export type ProgressBarVariant = 'xp' | 'points' | 'completion';

const GRADIENT: Record<ProgressBarVariant, [string, string]> = {
  xp: [palette.xp[400], palette.xp[600]],
  points: [palette.gold[300], palette.gold[500]],
  completion: [palette.primary[300], palette.primary[500]],
};

/**
 * Clamps to the 0-100 range a progress bar can actually draw. `NaN` (a 0-over-0 ratio, for a reward
 * with no cost yet) folds to 0 rather than propagating into a `NaN%` width, which React Native
 * renders as nothing at all with no error to explain why the bar vanished.
 */
export function clampPercent(percent: number): number {
  if (Number.isNaN(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

interface ProgressBarProps {
  /** 0-100. Out-of-range and NaN values are clamped rather than trusted. */
  percent: number;
  variant: ProgressBarVariant;
  /** What the bar measures, e.g. "Level 4 progress" or "Saving for a new bike". Read by itself, so
   *  it should stand alone rather than assume nearby on-screen text. */
  label: string;
  style?: ViewStyle;
}

const HEIGHT = 10;

export function ProgressBar({ percent, variant, label, style }: ProgressBarProps) {
  const theme = useTheme();
  const clamped = clampPercent(percent);

  return (
    <View
      style={[styles.track, { backgroundColor: theme.border }, style]}
      // Explicit rather than relying on the role to imply it: without this the track and its
      // gradient fill are two separate nodes to a screen reader (a plain coloured bar, then a
      // second unlabelled one), instead of the single progressbar with one spoken value this is
      // meant to be.
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
    >
      <LinearGradient
        colors={GRADIENT[variant]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.fill, { width: `${clamped}%` }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: HEIGHT,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.full,
  },
});
