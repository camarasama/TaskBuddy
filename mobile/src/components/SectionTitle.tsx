/**
 * A heading between groups of cards: "Available tasks", "Saving up", "Still to earn".
 *
 * Replaces the tiny grey uppercase labels that used to separate sections, which were easy to scroll
 * straight past. An icon tile in the section's colour, then a real heading.
 */
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

interface SectionTitleProps {
  title: string;
  icon: IoniconName;
  tone: AccentTone;
  /** One short line under the heading, for a rule that applies to the whole section. */
  hint?: string;
}

export function SectionTitle({ title, icon, tone, hint }: SectionTitleProps) {
  const theme = useTheme();

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <IconTile tone={tone} icon={icon} size={30} />
        <AppText
          variant="display"
          accessibilityRole="header"
          style={[styles.title, { color: theme.foreground }]}
        >
          {title}
        </AppText>
      </View>
      {hint ? <AppText style={[styles.hint, { color: theme.mutedForeground }]}>{hint}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginTop: spacing[4], marginBottom: spacing[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: {
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.bold,
  },
  hint: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
});
