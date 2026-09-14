import { fireEvent, render } from '@testing-library/react-native';

import { ChildPicker } from '@/components/ChildPicker';
import { ChoicePills } from '@/components/ChoicePills';
import { ToggleRow } from '@/components/ToggleRow';

// Same reason as StatTile.test.tsx: AppText pulls in expo-font, which cannot resolve expo-asset here.
jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));
// The icon component calls `Font.isLoaded`, which the mock above does not provide. See Field.test.tsx.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

/**
 * Three renders, one per control, on purpose: past a handful of renders in one mobile test file the
 * tree starts coming back empty (see the mobile render-test note in the repo's memory). Each test
 * checks the accessibility contract that replaced a text-glyph checkbox, which is the part a restyle
 * could silently break.
 */
describe('form kit', () => {
  it('ToggleRow is a switch that reports its state and toggles', async () => {
    const onToggle = jest.fn();
    const { getByRole } = await render(
      <ToggleRow label="Repeat this task" detail="A new copy appears each day." value onToggle={onToggle} />
    );

    const row = getByRole('switch');
    expect(row.props.accessibilityLabel).toBe('Repeat this task');
    expect(row.props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(row);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('ChoicePills are radios: the selected one is checked and a tap reports its value', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <ChoicePills
        label="Due"
        options={[
          { value: 0, label: 'Today' },
          { value: 1, label: 'Tomorrow' },
        ]}
        value={1}
        onChange={onChange}
      />
    );

    expect(getByLabelText('Tomorrow').props.accessibilityState).toMatchObject({ checked: true });
    expect(getByLabelText('Today').props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(getByLabelText('Today'));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('ChildPicker is a checkbox per child, and a disabled picker ignores taps', async () => {
    const onToggle = jest.fn();
    const { getByLabelText } = await render(
      <ChildPicker
        options={[
          { id: 'c1', firstName: 'Maya' },
          { id: 'c2', firstName: 'Leo' },
        ]}
        selected={['c1']}
        onToggle={onToggle}
        disabled
      />
    );

    expect(getByLabelText('Maya').props.accessibilityRole).toBe('checkbox');
    expect(getByLabelText('Maya').props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    expect(getByLabelText('Leo').props.accessibilityState).toMatchObject({ checked: false });
    fireEvent.press(getByLabelText('Leo'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
