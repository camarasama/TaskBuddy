/**
 * What a list says when it has nothing in it.
 *
 * A one-line grey sentence in a white card looked like a loading failure. A friendly emoji and a clear
 * sentence reads as "nothing here, and that is fine". The copy stays literal, per the recap screen's
 * rule: an empty list is described, never dressed up as praise the child did not earn.
 */
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

interface EmptyStateProps {
  emoji: string;
  title: string;
  message?: string;
}

export function EmptyState({ emoji, title, message }: EmptyStateProps) {
  const theme = useTheme();

  return (
    <Card>
      <View style={styles.body} accessible accessibilityRole="text" accessibilityLabel={[title, message].filter(Boolean).join('. ')}>
        <AppText style={styles.emoji} importantForAccessibility="no">
          {emoji}
        </AppText>
        <AppText style={[styles.title, { color: theme.cardForeground }]}>{title}</AppText>
        {message ? <AppText style={[styles.message, { color: theme.mutedForeground }]}>{message}</AppText> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  body: { alignItems: 'center', paddingVertical: spacing[3] },
  emoji: { fontSize: 40 },
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
    marginTop: spacing[2],
  },
  message: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, textAlign: 'center', marginTop: spacing[1] },
});
