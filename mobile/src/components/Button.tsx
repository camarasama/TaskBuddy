/**
 * The app's button.
 *
 * Centralises two things worth not repeating: the 44dp minimum hit target from the tokens (native has
 * no global equivalent of the web's `globals.css` rule, so every touchable would otherwise have to
 * remember it), and the busy state, which disables the press as well as showing a spinner.
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';

import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

type Variant = 'primary' | 'secondary';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  /** Shows a spinner and blocks presses. Use for in-flight requests. */
  busy?: boolean;
  disabled?: boolean;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
}: ButtonProps) {
  const theme = useTheme();
  const inactive = disabled || busy;

  const background = variant === 'primary' ? theme.primary : theme.secondary;
  const foreground = variant === 'primary' ? theme.primaryForeground : theme.secondaryForeground;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Announces the blocked state to TalkBack, which a visual dim alone does not.
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: background, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.content}>
        {busy && <ActivityIndicator size="small" color={foreground} />}
        <AppText style={[styles.label, { color: foreground }]}>{label}</AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTouchTarget,
    borderRadius: radius.lg,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    justifyContent: 'center',
  },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  label: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
  },
});
