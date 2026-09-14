import { fireEvent, render } from '@testing-library/react-native';

import { SegmentedControl } from '@/components/SegmentedControl';

// Same reason as StatTile.test.tsx: AppText pulls in expo-font, which cannot resolve expo-asset here.
jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));

describe('SegmentedControl', () => {
  it('speaks each count as part of the option name and marks the selected one', async () => {
    const { getByLabelText } = await render(
      <SegmentedControl
        options={[
          { key: 'active', label: 'Active', count: 2 },
          { key: 'completed', label: 'Completed', count: 19 },
        ]}
        value="active"
        onChange={() => {}}
      />
    );

    expect(getByLabelText('Active, 2').props.accessibilityState).toEqual({ selected: true });
    expect(getByLabelText('Completed, 19').props.accessibilityState).toEqual({ selected: false });
  });

  it('reports the tapped option, and names an option without a count by its label alone', async () => {
    const onChange = jest.fn();
    const { getByLabelText } = await render(
      <SegmentedControl
        options={[
          { key: 'shop', label: 'Shop' },
          { key: 'mine', label: 'My rewards' },
        ]}
        value="shop"
        onChange={onChange}
      />
    );

    fireEvent.press(getByLabelText('My rewards'));
    expect(onChange).toHaveBeenCalledWith('mine');
  });
});
