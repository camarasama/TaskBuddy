/**
 * The small uppercase label at the top of a card, with an icon that says what the card is about.
 *
 * Every dashboard card had grown its own copy of the same four style properties; this is that block
 * plus the icon, in one place, so a screen adding a card gets the right type scale by construction.
 *
 * ## On the icon and screen readers
 *
 * `Ionicons` renders a glyph inside a `Text`, so a reader left to itself announces the private-use
 * codepoint — a stray character before every heading. It is hidden here and the label carries the
 * whole meaning, which is also why `icon` is never the only thing this component renders.
 *
 * ## On `tint` and `color`
 *
 * The label defaults to `mutedForeground`: it is chrome, and it has to clear AA against both card
 * colours. The icon is the piece that is allowed to carry a gamification accent (gold for points,
 * xp for levelling, and so on), because a glyph is not body text. Pass a `palette` step for that;
 * pass nothing and it matches the label.
 *
 * `color` exists only for a card that is not `theme.card` — the child dashboard's points card is
 * filled with `theme.primary`, where `mutedForeground` would be slate on teal and unreadable. It
 * takes the matching `…Foreground` role, never a hand-picked colour.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface CardHeadingProps {
  icon: IoniconName;
  label: string;
  /**
   * Icon colour. Defaults to the label's. Reach into `palette` for this only where the colour *is*
   * the meaning — anything structural belongs to `useTheme()`.
   */
  tint?: string;
  /** Label colour, for a card whose surface is not `theme.card`. Defaults to `mutedForeground`. */
  color?: string;
}

export function CardHeading({ icon, label, tint, color }: CardHeadingProps) {
  const theme = useTheme();
  const labelColor = color ?? theme.mutedForeground;

  return (
    <View style={styles.row}>
      <Ionicons
        name={icon}
        size={ICON_SIZE}
        color={tint ?? labelColor}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <AppText style={[styles.label, { color: labelColor }]}>{label}</AppText>
    </View>
  );
}

/** Sized against the 12dp label rather than the 44dp touch floor — this is not a target. */
const ICON_SIZE = 16;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  label: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
