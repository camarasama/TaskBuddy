/**
 * A titled group of related fields on a form: "The task", "Points and time", "Who's doing it?".
 *
 * The parent forms were one long column of fields separated only by whitespace, which made a
 * twelve-control task form feel endless and hid which settings belonged together. A white card with a
 * coloured tile and a heading splits the form into steps a parent can scan.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { elevation, fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

interface FormSectionProps {
  title: string;
  icon: IoniconName;
  tone: AccentTone;
  /** One short line under the title, for something true of the whole section. */
  hint?: string;
  children: ReactNode;
}

export function FormSection({ title, icon, tone, hint, children }: FormSectionProps) {
  const theme = useTheme();

  return (
    <View style={[styles.card, elevation.card, { backgroundColor: theme.card }]}>
      <View style={styles.head}>
        <IconTile tone={tone} icon={icon} size={32} />
        <View style={styles.headText}>
          <AppText variant="display" accessibilityRole="header" style={[styles.title, { color: theme.cardForeground }]}>
            {title}
          </AppText>
          {hint ? <AppText style={[styles.hint, { color: theme.mutedForeground }]}>{hint}</AppText> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: spacing[4], marginBottom: spacing[4] },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[4] },
  headText: { flex: 1 },
  title: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.bold },
  hint: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight },
});
