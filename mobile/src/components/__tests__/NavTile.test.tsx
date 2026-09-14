import { fireEvent, render } from '@testing-library/react-native';

import { IconButton } from '@/components/IconButton';
import { NavTile } from '@/components/NavTile';

// Same reason as StatTile.test.tsx: AppText pulls in expo-font, which cannot resolve expo-asset here.
jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));
// The icon component calls `Font.isLoaded`, which the mock above does not provide. The glyph is
// decorative here (the label carries the meaning), so a bare host element loses nothing. See Field.test.tsx.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

describe('NavTile', () => {
  it('is one button whose name carries the title, badge and detail, and it opens on press', async () => {
    const onPress = jest.fn();
    const { getByLabelText } = await render(
      <NavTile title="Notifications" subtitle="3 unread messages" badge="3 new" icon="notifications" tone="primary" onPress={onPress} />
    );

    const tile = getByLabelText('Notifications, 3 new, 3 unread messages');
    expect(tile.props.accessibilityRole).toBe('button');
    fireEvent.press(tile);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('IconButton', () => {
  it('has a spoken name, reports its toggle state, and does nothing while disabled', async () => {
    const onPress = jest.fn();
    const { getByLabelText } = await render(
      <IconButton icon="heart" label="Un-heart" tone="destructive" active disabled onPress={onPress} />
    );

    const button = getByLabelText('Un-heart');
    expect(button.props.accessibilityState).toEqual({ disabled: true, selected: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
