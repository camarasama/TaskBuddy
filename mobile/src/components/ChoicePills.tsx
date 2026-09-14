/**
 * Pick one of a few options, shown as pills: due date, repeat pattern, reward size, report format.
 *
 * Every parent form had its own copy of a row of outlined `Pressable`s with the selected one filled
 * teal, five near-identical blocks of styles. One component, and the selected pill is a teal tint with
 * a teal edge rather than a solid fill, so a row of them does not read as a row of primary buttons.
 *
 * Each pill is announced as a radio button in a radio group, with its selection state.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import type { IoniconName } from '@/components/IconTile';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

export interface ChoiceOption<V extends string | number> {
  value: V;
  label: string;
  icon?: IoniconName;
}

interface ChoicePillsProps<V extends string | number> {
  options: ChoiceOption<V>[];
  value: V;
  onChange: (next: V) => void;
  disabled?: boolean;
  /** Spoken name for the whole group ("Due", "Size"). */
  label: string;
}

export function ChoicePills<V extends string | number>({ options, value, onChange, disabled = false, label }: ChoicePillsProps<V>) {
  const theme = useTheme();

  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        const ink = selected ? theme.primary : theme.cardForeground;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected, checked: selected, disabled }}
            style={({ pressed }) => [
              styles.pill,
              {
                backgroundColor: selected ? theme.card : theme.muted,
                borderColor: selected ? theme.primary : 'transparent',
                opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {option.icon ? (
              <Ionicons name={option.icon} size={16} color={ink} importantForAccessibility="no" accessibilityElementsHidden />
            ) : null}
            <AppText style={[styles.label, { color: ink }]}>{option.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  pill: {
    minHeight: minTouchTarget,
    borderRadius: radius.full,
    borderWidth: 2,
    paddingHorizontal: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  label: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.semibold },
});
