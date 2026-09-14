/**
 * Choose any number of children, by face: the task form's "Who's doing it?" and a report's child.
 *
 * A column of "☐ Maya" text rows asked a parent to read; an avatar chip is found at a glance, and it is
 * the same avatar the child sees on their own home screen. Each chip is a checkbox for screen readers.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { fontSize, fontWeight, minTouchTarget, onGradient, radius, spacing, useTheme } from '@/theme';

export interface PickableChild {
  id: string;
  firstName: string;
}

interface ChildPickerProps {
  /** Not `children`: that name belongs to React's own child elements. */
  options: PickableChild[];
  selected: string[];
  onToggle: (childId: string) => void;
  disabled?: boolean;
}

export function ChildPicker({ options, selected, onToggle, disabled = false }: ChildPickerProps) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {options.map((child) => {
        const on = selected.includes(child.id);
        return (
          <Pressable
            key={child.id}
            onPress={() => onToggle(child.id)}
            disabled={disabled}
            accessibilityRole="checkbox"
            accessibilityLabel={child.firstName}
            accessibilityState={{ checked: on, disabled }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: on ? theme.card : theme.muted,
                borderColor: on ? theme.primary : 'transparent',
                opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {/* Hidden: the avatar carries its own label, which would make every chip announce the
                child's name twice. The chip's label already says it. */}
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <Avatar seed={child.id} name={child.firstName} size={32} />
            </View>
            <AppText style={[styles.name, { color: on ? theme.primary : theme.cardForeground }]}>{child.firstName}</AppText>
            {on ? (
              <View style={[styles.tick, { backgroundColor: theme.primary }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Ionicons name="checkmark" size={13} color={onGradient} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    minHeight: minTouchTarget,
    borderRadius: radius.full,
    borderWidth: 2,
    paddingLeft: spacing[1],
    paddingRight: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  name: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.semibold },
  tick: { width: 18, height: 18, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
