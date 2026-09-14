/**
 * An on/off setting: a label, one line explaining it, and a switch.
 *
 * Replaces the "☐" / "☑" text characters the task and reward forms drew as checkboxes, and Settings'
 * own checkbox rows. A text glyph renders at a different size on every Android font and reads as a
 * typo; a drawn switch does not. The whole row is the target, and it is announced as a switch with its
 * state, the same contract the old rows had as checkboxes.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { fontSize, fontWeight, minTouchTarget, onGradient, radius, spacing, useTheme } from '@/theme';

interface ToggleRowProps {
  label: string;
  detail?: string;
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** Draws a rule above the row, for a stack of toggles inside one section. */
  divider?: boolean;
}

const TRACK_W = 46;
const TRACK_H = 28;
const KNOB = 22;

export function ToggleRow({ label, detail, value, onToggle, disabled = false, divider = false }: ToggleRowProps) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={detail}
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [
        styles.row,
        divider && [styles.divider, { borderTopColor: theme.border }],
        { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      <View style={styles.text}>
        <AppText style={[styles.label, { color: theme.cardForeground }]}>{label}</AppText>
        {detail ? <AppText style={[styles.detail, { color: theme.mutedForeground }]}>{detail}</AppText> : null}
      </View>
      <View
        style={[styles.track, { backgroundColor: value ? theme.primary : theme.border }]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <View style={[styles.knob, { backgroundColor: onGradient, alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], minHeight: minTouchTarget, paddingVertical: spacing[2] },
  divider: { borderTopWidth: 1, marginTop: spacing[1], paddingTop: spacing[3] },
  text: { flex: 1 },
  label: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.semibold },
  detail: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  track: {
    width: TRACK_W,
    height: TRACK_H,
    borderRadius: radius.full,
    padding: (TRACK_H - KNOB) / 2,
    justifyContent: 'center',
  },
  knob: { width: KNOB, height: KNOB, borderRadius: radius.full },
});
