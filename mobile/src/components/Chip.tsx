/**
 * A tinted pill: a status label, the points pill ("25 pts"), or a filter toggle.
 *
 * `variant` carries the colour and `onPress` carries the behaviour, and the two are independent on
 * purpose. A status chip (`pending`, `gold` for points, and so on) is read-only and never takes
 * `onPress`; a filter chip takes `onPress` and the caller picks which variant to render for the
 * selected state versus the rest: typically `primary` (filled) for the one that is selected and
 * `info` (tinted) for the ones that are not. Baking a fixed "selected" and "unselected" pair into
 * this component would stop a screen from using, say, `late` to mean "chip for the late filter,
 * currently active", which the redesign's tasks screen wants.
 *
 * `primary` is the one variant that reads from `useTheme()` instead of a fixed palette pair: it is a
 * solid, fully-saturated fill rather than a light tint, so it needs the same light/dark swap a
 * primary button gets (500 in light mode, the lightened 400 in dark mode) to keep its text at AA
 * contrast on both. The tinted variants are deliberately theme-independent: see the note in
 * `StatTile.tsx`.
 */
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { fontSize, fontWeight, minTouchTarget, palette, radius, spacing, useTheme } from '@/theme';

export type ChipVariant = 'pending' | 'done' | 'late' | 'info' | 'gold' | 'primary';

interface ChipColors {
  background: string;
  foreground: string;
}

/** Every variant except `primary`, which is computed from `useTheme()` in the component itself. */
const TINTED_COLOR: Record<Exclude<ChipVariant, 'primary'>, ChipColors> = {
  pending: { background: palette.warning[100], foreground: palette.warning[700] },
  done: { background: palette.success[100], foreground: palette.success[700] },
  late: { background: palette.destructive[100], foreground: palette.destructive[700] },
  info: { background: palette.primary[100], foreground: palette.primary[700] },
  gold: { background: palette.gold[100], foreground: palette.gold[700] },
};

interface ChipProps {
  label: string;
  variant: ChipVariant;
  /** Present only for a chip acting as a filter toggle; renders as a `Pressable` and reports its
   *  toggle state to a screen reader. Omit for a static status or points pill. */
  onPress?: () => void;
  /** Only meaningful alongside `onPress`; reported as `accessibilityState.selected`. */
  selected?: boolean;
  style?: ViewStyle;
}

export function Chip({ label, variant, onPress, selected, style }: ChipProps) {
  const theme = useTheme();
  const { background, foreground } =
    variant === 'primary'
      ? { background: theme.primary, foreground: theme.primaryForeground }
      : TINTED_COLOR[variant];

  const content = (
    <AppText style={[styles.label, { color: foreground }]} numberOfLines={1}>
      {label}
    </AppText>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        style={({ pressed }) => [
          styles.pill,
          styles.pressable,
          { backgroundColor: background, opacity: pressed ? 0.85 : 1 },
          style,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      style={[styles.pill, { backgroundColor: background }, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  // Matches Button's floor rather than a smaller hitSlop-only target, so every tappable primitive in
  // the app answers the same minimum-size question the same way.
  pressable: {
    minHeight: minTouchTarget,
  },
  label: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
  },
});
