import { act, render } from '@testing-library/react-native';

import { Avatar } from '@/components/Avatar';

// Its own file, not Avatar.test.tsx: that file already has seven renders, and past four or five in
// one mobile test file the tree comes back empty.
jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));

describe('Avatar with an uploaded picture', () => {
  it('shows the picture instead of the initial, under the same accessibility label', async () => {
    const view = await render(<Avatar seed="child-1" name="Maya" uri="https://cdn.example/maya.jpg" />);

    expect(view.getByTestId('avatar-image').props.source).toEqual({ uri: 'https://cdn.example/maya.jpg' });
    expect(view.queryByText('M')).toBeNull();
    expect(view.getByLabelText('Maya')).toBeTruthy();
    await view.unmount();
  });

  it('falls back to the gradient and initial when the picture fails to load', async () => {
    // A deleted object or no signal must not leave an empty hole in a row.
    const view = await render(<Avatar seed="child-1" name="Maya" uri="https://cdn.example/gone.jpg" />);

    await act(async () => {
      view.getByTestId('avatar-image').props.onError();
    });

    expect(view.queryByTestId('avatar-image')).toBeNull();
    expect(view.getByText('M')).toBeTruthy();
    await view.unmount();
  });
});
