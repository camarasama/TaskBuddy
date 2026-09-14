/**
 * The save bar pinned under a long form: the main action, and a quiet way out.
 *
 * On the task form "Create task" sat below twelve controls, so a parent had to scroll to the very end
 * to find out whether the form could be saved at all. Passed to `Screen`'s `footer` slot, it stays in
 * view while the fields scroll, and it sits above the keyboard on Android because the window resizes.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

interface FormFooterProps {
  /** The primary `Button`, rendered full width. */
  children: ReactNode;
  /** The quiet text action under it ("Cancel", "Go back"). Omit for none. */
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
}

export function FormFooter({ children, secondaryLabel, onSecondary, secondaryDisabled = false }: FormFooterProps) {
  const theme = useTheme();

  return (
    <View style={[styles.bar, { backgroundColor: theme.card, borderTopColor: theme.border }]}>
      {children}
      {secondaryLabel && onSecondary ? (
        <Pressable
          onPress={onSecondary}
          disabled={secondaryDisabled}
          accessibilityRole="button"
          accessibilityLabel={secondaryLabel}
          accessibilityState={{ disabled: secondaryDisabled }}
          style={({ pressed }) => [styles.secondary, { opacity: secondaryDisabled ? 0.5 : pressed ? 0.7 : 1 }]}
        >
          <AppText style={[styles.secondaryLabel, { color: theme.mutedForeground }]}>{secondaryLabel}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: 1, paddingHorizontal: spacing[6], paddingTop: spacing[3], paddingBottom: spacing[2], gap: spacing[1] },
  secondary: { minHeight: minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.semibold },
});
