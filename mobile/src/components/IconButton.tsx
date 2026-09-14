/**
 * A round, icon-only button with a spoken name: heart a reward, pin it as the goal.
 *
 * The reward shop had "Heart" and "Save for" written out as grey buttons beside "Get it", three equal
 * slabs per card where only one was the purchase. A heart is universally understood as an icon, and
 * making the preferences small lets the real action stand out.
 *
 * `label` is required because an icon has no text for a screen reader to fall back on.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';

import type { IoniconName } from '@/components/IconTile';
import { minTouchTarget, radius } from '@/theme';
import { TINT, type AccentTone } from '@/theme/accents';

interface IconButtonProps {
  icon: IoniconName;
  label: string;
  tone: AccentTone;
  onPress: () => void;
  /** For a toggle: filled tile when on, and reported as `selected`. */
  active?: boolean;
  disabled?: boolean;
}

export function IconButton({ icon, label, tone, onPress, active, disabled = false }: IconButtonProps) {
  const tint = TINT[tone];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: tint.fill, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      <Ionicons name={icon} size={22} color={tint.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: minTouchTarget,
    height: minTouchTarget,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
