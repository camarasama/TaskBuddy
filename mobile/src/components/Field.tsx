/**
 * Labelled text input.
 *
 * The label is a real `<AppText>` tied to the input via `accessibilityLabel` rather than a placeholder
 * standing in for one. Placeholder-as-label disappears the moment typing starts and is not announced
 * reliably by screen readers — and Play's Families review does look at TalkBack behaviour.
 */
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { AppText } from '@/components/AppText';

import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

interface FieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  /** Per-field validation message. Also flips the border, so the error is not colour-only. */
  error?: string;
  hint?: string;
}

export function Field({ label, error, hint, ...inputProps }: FieldProps) {
  const theme = useTheme();

  return (
    <View style={styles.wrapper}>
      <AppText style={[styles.label, { color: theme.mutedForeground }]}>{label}</AppText>
      <TextInput
        {...inputProps}
        accessibilityLabel={label}
        accessibilityHint={hint}
        placeholderTextColor={theme.mutedForeground}
        // Android centres multiline text vertically by default, which looks like a bug in a box tall
        // enough to hold a sentence.
        textAlignVertical={inputProps.multiline ? 'top' : 'center'}
        style={[
          styles.input,
          {
            backgroundColor: theme.card,
            color: theme.cardForeground,
            borderColor: error ? theme.destructive : theme.input,
          },
          inputProps.multiline && styles.multiline,
        ]}
      />
      {hint !== undefined && !error && (
        <AppText style={[styles.hint, { color: theme.mutedForeground }]}>{hint}</AppText>
      )}
      {error !== undefined && (
        // `alert` so a screen reader announces the message when it appears, rather than only on focus.
        <AppText accessibilityRole="alert" style={[styles.hint, { color: theme.destructive }]}>
          {error}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing[4] },
  label: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.medium,
    marginBottom: spacing[2],
  },
  input: {
    minHeight: minTouchTarget,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: fontSize.base.fontSize,
  },
  hint: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[2],
  },
  /** Tall enough for a couple of lines without the user having to scroll inside the box to see them. */
  multiline: { minHeight: minTouchTarget * 2, paddingTop: spacing[3] },
});
