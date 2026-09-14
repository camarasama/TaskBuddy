/**
 * A pill track of two or three options: Active / Completed / Returned, Shop / My rewards.
 *
 * Tasks and Rewards each had their own copy of a row of outlined chips, which on a phone read as three
 * unrelated buttons. One track with the selected option filled reads as a single switch, and both
 * screens now share it.
 *
 * Every option keeps the 44dp floor. A count, when given, is part of the spoken name rather than a
 * separate unlabelled number.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { elevation, fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

export interface SegmentOption<K extends string> {
  key: K;
  label: string;
  count?: number;
}

interface SegmentedControlProps<K extends string> {
  options: SegmentOption<K>[];
  value: K;
  onChange: (next: K) => void;
}

export function SegmentedControl<K extends string>({ options, value, onChange }: SegmentedControlProps<K>) {
  const theme = useTheme();

  return (
    <View style={[styles.track, { backgroundColor: theme.muted }]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.key === value;
        const count = option.count ?? 0;
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.count === undefined ? option.label : `${option.label}, ${count}`}
            style={[styles.option, selected && [styles.selected, elevation.card, { backgroundColor: theme.primary }]]}
          >
            <AppText
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={[styles.label, { color: selected ? theme.primaryForeground : theme.mutedForeground }]}
            >
              {option.label}
            </AppText>
            {count > 0 && (
              <View
                style={[
                  styles.count,
                  { backgroundColor: selected ? theme.primaryForeground : theme.card },
                ]}
              >
                <AppText style={[styles.countLabel, { color: selected ? theme.primary : theme.cardForeground }]}>
                  {count}
                </AppText>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.full,
    padding: spacing[1],
    gap: spacing[1],
    marginBottom: spacing[4],
  },
  option: {
    flex: 1,
    minHeight: minTouchTarget,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
  },
  selected: {},
  label: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.semibold, flexShrink: 1 },
  count: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    paddingHorizontal: spacing[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  countLabel: { fontSize: fontSize.xs.fontSize, fontWeight: fontWeight.bold },
});
