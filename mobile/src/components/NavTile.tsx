/**
 * A tappable row that opens another screen: icon tile, title, one line of detail, chevron.
 *
 * The Me hub used to be a stack of cards each ending in a grey "See all" button, so every card had two
 * things on it that looked tappable and only one that was. The whole tile is the target now, and the
 * chevron says where it goes.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { elevation, fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

interface NavTileProps {
  title: string;
  subtitle?: string;
  icon: IoniconName;
  tone: AccentTone;
  onPress: () => void;
  /** A short count or flag shown as a pill before the chevron ("3 new"). */
  badge?: string;
}

export function NavTile({ title, subtitle, icon, tone, onPress, badge }: NavTileProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, badge, subtitle].filter(Boolean).join(', ')}
      style={({ pressed }) => [
        styles.tile,
        elevation.card,
        { backgroundColor: theme.card, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <IconTile tone={tone} icon={icon} size={48} />
      <View style={styles.text}>
        <AppText style={[styles.title, { color: theme.cardForeground }]}>{title}</AppText>
        {subtitle ? (
          <AppText style={[styles.subtitle, { color: theme.mutedForeground }]} numberOfLines={2}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {badge ? (
        <View style={[styles.badge, { backgroundColor: theme.primary }]}>
          <AppText style={[styles.badgeLabel, { color: theme.primaryForeground }]}>{badge}</AppText>
        </View>
      ) : null}
      <Ionicons
        name="chevron-forward"
        size={20}
        color={theme.mutedForeground}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: minTouchTarget,
    borderRadius: radius.lg,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  text: { flex: 1 },
  title: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.semibold },
  subtitle: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  badge: { borderRadius: radius.full, paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
  badgeLabel: { fontSize: fontSize.xs.fontSize, fontWeight: fontWeight.bold },
});
