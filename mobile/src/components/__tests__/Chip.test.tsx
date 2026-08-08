import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Chip } from '@/components/Chip';
import { palette } from '@/theme';

// Same reason as StatTile.test.tsx: importing AppText pulls in expo-font, which this monorepo's npm
// install cannot resolve expo-asset for. See that file for the full explanation.
jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));

const TINTED: Record<'pending' | 'done' | 'late' | 'info' | 'gold', { background: string; foreground: string }> = {
  pending: { background: palette.warning[100], foreground: palette.warning[700] },
  done: { background: palette.success[100], foreground: palette.success[700] },
  late: { background: palette.destructive[100], foreground: palette.destructive[700] },
  info: { background: palette.primary[100], foreground: palette.primary[700] },
  gold: { background: palette.gold[100], foreground: palette.gold[700] },
};

describe('Chip (static, no onPress)', () => {
  it.each(Object.keys(TINTED) as (keyof typeof TINTED)[])(
    'variant "%s" renders a static pill with its tinted background',
    async (variant) => {
      const { getByLabelText } = await render(<Chip label="25 pts" variant={variant} />);

      const chip = getByLabelText('25 pts');
      const flat = StyleSheet.flatten(chip.props.style);

      expect(flat.backgroundColor).toBe(TINTED[variant].background);
      expect(chip.props.accessibilityRole).toBe('text');
    }
  );

  it('gives every tinted variant a distinct background', () => {
    const backgrounds = Object.values(TINTED).map((c) => c.background);
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
  });
});

describe('Chip (interactive filter, onPress provided)', () => {
  it('renders as a pressable button and reports its role', async () => {
    const { getByRole } = await render(
      <Chip label="All" variant="primary" selected onPress={() => {}} />
    );

    const chip = getByRole('button');
    expect(chip.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  it('fires onPress when pressed', async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(<Chip label="All" variant="primary" onPress={onPress} />);

    fireEvent.press(getByRole('button'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
