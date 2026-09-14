/**
 * A short coloured message about a state: "Approved, +20 points", "A photo was asked for but none was
 * attached", "Every reward has been given out".
 *
 * These used to be paragraphs in red or teal text dropped between cards, or a card with a coloured
 * border. A tinted block with an icon and, where useful, a bold first line, says what kind of message it
 * is before it is read. The tint pairs are the fixed 100/700-800 pairs from `theme/accents.ts`.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IoniconName } from '@/components/IconTile';
import { fontSize, fontWeight, radius, spacing } from '@/theme';
import { TINT } from '@/theme/accents';

export type CalloutKind = 'success' | 'warning' | 'info' | 'danger';

const KIND: Record<CalloutKind, { tone: keyof typeof TINT; icon: IoniconName }> = {
  success: { tone: 'success', icon: 'checkmark-circle' },
  warning: { tone: 'warning', icon: 'alert-circle' },
  info: { tone: 'primary', icon: 'information-circle' },
  danger: { tone: 'destructive', icon: 'alert-circle' },
};

interface CalloutProps {
  kind: CalloutKind;
  title?: string;
  children?: ReactNode;
  /** Overrides the kind's default icon. */
  icon?: IoniconName;
  /** `alert` for something that just happened (an error, a result); omit for standing information. */
  live?: boolean;
}

export function Callout({ kind, title, children, icon, live = false }: CalloutProps) {
  const { tone, icon: defaultIcon } = KIND[kind];
  const tint = TINT[tone];

  return (
    <View style={[styles.box, { backgroundColor: tint.fill }]} accessibilityRole={live ? 'alert' : undefined}>
      <Ionicons name={icon ?? defaultIcon} size={20} color={tint.ink} importantForAccessibility="no" accessibilityElementsHidden />
      <View style={styles.text}>
        {title ? <AppText style={[styles.title, { color: tint.textInk }]}>{title}</AppText> : null}
        {typeof children === 'string' ? (
          <AppText style={[styles.body, { color: tint.textInk }]}>{children}</AppText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', gap: spacing[3], borderRadius: radius.lg, padding: spacing[3], marginBottom: spacing[4] },
  text: { flex: 1 },
  title: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, fontWeight: fontWeight.bold },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
});
