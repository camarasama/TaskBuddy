/**
 * Surface container.
 *
 * Mirrors the web's `.card`: the `card` colour sits on the `appBackground` one, which is why the
 * tokens carry both — on the web `--background` is white while the body is slate-50, so a card is
 * white *against* off-white. Using `background` here instead would render white on white and lose all
 * card definition. See the note on `themes` in the tokens.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { radius, spacing, useTheme } from '@/theme';

interface CardProps {
  children: ReactNode;
  /** Merged last, so a caller can emphasise a card — a coloured border for something urgent. */
  style?: ViewStyle;
}

export function Card({ children, style }: CardProps) {
  const theme = useTheme();

  return (
    <View
      style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
  },
});
