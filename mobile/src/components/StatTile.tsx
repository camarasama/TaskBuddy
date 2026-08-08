/**
 * A tinted number-and-label tile, for a row of headline stats (parent dashboard: To approve / Done
 * today / Points out).
 *
 * The tint is a fixed light/dark pair from the palette rather than anything from `useTheme()`: a
 * status colour is supposed to read the same regardless of the device's appearance setting, the way
 * a warning badge does not go dim just because the phone is in dark mode. See the hard rule in the
 * redesign spec: a surface either follows `useTheme()` or is a palette pair that already works on
 * both grounds, and `100`/`700` on the same hue is exactly that pair.
 */
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { fontSize, fontWeight, palette, spacing, radius } from '@/theme';

export type StatTileVariant = 'warning' | 'success' | 'gold' | 'info';

interface StatTileColors {
  background: string;
  foreground: string;
}

const VARIANT_COLOR: Record<StatTileVariant, StatTileColors> = {
  warning: { background: palette.warning[100], foreground: palette.warning[700] },
  success: { background: palette.success[100], foreground: palette.success[700] },
  gold: { background: palette.gold[100], foreground: palette.gold[700] },
  info: { background: palette.primary[100], foreground: palette.primary[700] },
};

interface StatTileProps {
  /** The headline figure. A string so a caller can pass something like "12+" without coercing. */
  value: string | number;
  label: string;
  variant: StatTileVariant;
  /** Merged onto the outer tile, for the three-across row's `flex: 1`. */
  style?: ViewStyle;
}

export function StatTile({ value, label, variant, style }: StatTileProps) {
  const { background, foreground } = VARIANT_COLOR[variant];

  return (
    // `accessible` groups the value and label into one screen-reader stop with a combined label,
    // instead of two separate stops that read the bare number and then the caption apart from it.
    <View
      style={[styles.tile, { backgroundColor: background }, style]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${value} ${label}`}
    >
      <AppText variant="display" style={[styles.value, { color: foreground }]}>
        {value}
      </AppText>
      <AppText style={[styles.label, { color: foreground }]}>{label}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2],
    alignItems: 'center',
  },
  value: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    // Fixed-width digits, so three tiles' numbers line up on the same baseline instead of a "1"
    // sitting narrower than an "8" and nudging the label beneath it sideways. iOS and Android both
    // honour `fontVariant`; a platform that does not just ignores the hint and renders proportional
    // digits, which is why this needs no Platform branch.
    fontVariant: ['tabular-nums'],
  },
  label: {
    marginTop: spacing[1],
    fontSize: fontSize.xs.fontSize,
    lineHeight: fontSize.xs.lineHeight,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
});
