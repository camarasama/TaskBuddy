/**
 * A child's gradient avatar: a rounded square filled with one of three brand gradients, and the
 * child's first initial on top.
 *
 * The gradient is deterministic per `seed` (pass the child's id, not their name, so a rename does
 * not reshuffle their colour): the same child renders the same gradient on the dashboard, the task
 * list and the leaderboard, which is what lets a parent recognise "that's Maya's card" at a glance
 * without reading the name every time.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { fontWeight, onGradient, palette, radius } from '@/theme';

/** Cycled by `avatarGradientIndex`. Order is meaningful only in that it is stable: do not reorder. */
const GRADIENTS: [string, string][] = [
  [palette.primary[400], palette.primary[600]],
  [palette.peach[300], palette.peach[500]],
  [palette.xp[400], palette.xp[600]],
];

/**
 * A stable index into `GRADIENTS` for a given seed. Deliberately not `Math.random` or an id's own
 * numeric value (ids are UUID strings, not evenly distributed small integers): a simple string hash
 * mod the gradient count, so the same seed always lands on the same gradient, and different seeds
 * spread reasonably evenly across the three.
 */
export function avatarGradientIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    // `| 0` keeps the accumulator a 32-bit int so this behaves the same on every runtime rather than
    // drifting into float precision on a long seed.
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % GRADIENTS.length;
}

interface AvatarProps {
  /** Identifies the child for the deterministic gradient. Use a stable id, not the display name. */
  seed: string;
  /** Only its first character is shown; pass the full name and let this pick the initial. */
  name: string;
  /** Edge length in dp. Defaults to a list-row size; the hero screen passes a larger value. */
  size?: number;
  style?: ViewStyle;
}

const DEFAULT_SIZE = 40;

export function Avatar({ seed, name, size = DEFAULT_SIZE, style }: AvatarProps) {
  const [start, end] = GRADIENTS[avatarGradientIndex(seed)];
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  return (
    <LinearGradient
      testID="avatar-gradient"
      colors={[start, end]}
      style={[styles.base, { width: size, height: size, borderRadius: radius.md }, style]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
    >
      <AppText
        variant="display"
        style={[styles.initial, { color: onGradient, fontSize: size * 0.45 }]}
      >
        {initial}
      </AppText>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    fontWeight: fontWeight.bold,
  },
});
