/**
 * A rounded, tinted square holding an emoji or an icon: the "sticker" at the start of a row.
 *
 * It is what lets a list be scanned by colour before it is read (gold for points and rewards, purple for
 * XP and games, peach for streaks), the same job the games grid's subject banners already do. Always
 * decorative: the row beside it carries the words, so the tile is hidden from screen readers.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from '@/components/AppText';
import { useTheme } from '@/theme';
import { TINT, type AccentTone } from '@/theme/accents';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface IconTileProps {
  tone: AccentTone;
  /** Wins over `icon` when both are given. */
  emoji?: string;
  icon?: IoniconName;
  /** Edge length in dp. The glyph scales with it. */
  size?: number;
  /** Greyed, for something not yet earned (a locked achievement). */
  muted?: boolean;
  style?: ViewStyle;
}

export function IconTile({ tone, emoji, icon, size = 44, muted = false, style }: IconTileProps) {
  const theme = useTheme();
  const tint = TINT[tone];
  const fill = muted ? theme.muted : tint.fill;
  const ink = muted ? theme.mutedForeground : tint.ink;

  return (
    <View
      testID="icon-tile"
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: Math.round(size * 0.3), backgroundColor: fill },
        style,
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {emoji ? (
        // No lineHeight: an emoji sized against a line box gets its top clipped on Android.
        <AppText style={{ fontSize: Math.round(size * 0.5), opacity: muted ? 0.5 : 1 }}>{emoji}</AppText>
      ) : icon ? (
        <Ionicons name={icon} size={Math.round(size * 0.5)} color={ink} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center' },
});
