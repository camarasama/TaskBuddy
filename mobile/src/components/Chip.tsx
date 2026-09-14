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
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { fontSize, fontWeight, minTouchTarget, palette, radius, spacing, useTheme } from '@/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * `xp` and `peach` joined for the child visual pass: XP is purple everywhere in the app and a streak is
 * peach, so a pill carrying either needed its own colour rather than borrowing `info`. Peach text is
 * 800, not 700: 700 on the 100 fill measures 4.30:1 and misses AA.
 */
export type ChipVariant = 'pending' | 'done' | 'late' | 'info' | 'gold' | 'primary' | 'xp' | 'peach';

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
  xp: { background: palette.xp[100], foreground: palette.xp[700] },
  peach: { background: palette.peach[100], foreground: palette.peach[800] },
};

interface ChipProps {
  label: string;
  variant: ChipVariant;
  /** A leading glyph (a star for points, a flame for a streak). Decorative: the label carries the meaning. */
  icon?: IoniconName;
  /** A tighter pill for a row of meta chips under a title. Filter chips keep the default size. */
  compact?: boolean;
  /** Present only for a chip acting as a filter toggle; renders as a `Pressable` and reports its
   *  toggle state to a screen reader. Omit for a static status or points pill. */
  onPress?: () => void;
  /** Only meaningful alongside `onPress`; reported as `accessibilityState.selected`. */
  selected?: boolean;
  style?: ViewStyle;
}

export function Chip({ label, variant, icon, compact, onPress, selected, style }: ChipProps) {
  const theme = useTheme();
  const { background, foreground } =
    variant === 'primary'
      ? { background: theme.primary, foreground: theme.primaryForeground }
      : TINTED_COLOR[variant];

  const text = (
    <AppText style={[styles.label, compact && styles.labelCompact, { color: foreground }]} numberOfLines={1}>
      {label}
    </AppText>
  );

  const content = icon ? (
    <View style={styles.withIcon}>
      <Ionicons
        name={icon}
        size={compact ? 12 : 14}
        color={foreground}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      {text}
    </View>
  ) : (
    text
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
      style={[styles.pill, compact && styles.pillCompact, { backgroundColor: background }, style]}
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
  pillCompact: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  withIcon: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  label: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  labelCompact: {
    fontSize: fontSize.xs.fontSize,
    lineHeight: fontSize.xs.lineHeight,
  },
});
