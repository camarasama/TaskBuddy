/**
 * One fact about a thing, as a row: tile, label, value. "Worth 20 points", "Due in 3 days".
 *
 * Detail screens listed facts as a column of grey lines with no labels ("20 points", "20 min", "Photo
 * required"), which read as a paragraph. A tile and a label make each line findable on its own.
 */
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

interface InfoRowProps {
  icon: IoniconName;
  tone: AccentTone;
  label: string;
  value: string;
  /** Value in the destructive colour, for an overdue date. Worded as well, never colour alone. */
  alert?: boolean;
}

export function InfoRow({ icon, tone, label, value, alert = false }: InfoRowProps) {
  const theme = useTheme();

  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <IconTile tone={tone} icon={icon} size={32} />
      <AppText style={[styles.label, { color: theme.mutedForeground }]}>{label}</AppText>
      <AppText style={[styles.value, { color: alert ? theme.destructive : theme.cardForeground }]}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[2] },
  label: { flex: 1, fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  value: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, fontWeight: fontWeight.semibold, flexShrink: 1, textAlign: 'right' },
});
