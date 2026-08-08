/**
 * `render` in this repo's `@testing-library/react-native` version returns a promise (it mounts a
 * React 19 concurrent root under the hood), so every test here awaits it. See `Card.tsx` for why the
 * stripe lives on a second, inner view rather than the same view as the shadow.
 */
import { render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { Card, CARD_STATUS_COLOR, type CardStatus } from '@/components/Card';

describe('Card', () => {
  it('renders no stripe when no status is passed, for the ~40 existing callers', async () => {
    const { queryByTestId } = await render(
      <Card>
        <Text>content</Text>
      </Card>
    );

    // The stripe is `accessibilityElementsHidden` by design (see Card.tsx), which RTL's default
    // queries also treat as absent: pass `includeHiddenElements` so this assertion checks the
    // component tree rather than accidentally checking the accessibility-hidden filter instead.
    expect(queryByTestId('card-stripe', { includeHiddenElements: true })).toBeNull();
  });

  it('still renders children with only children and style, the pre-redesign call signature', async () => {
    const { getByText } = await render(
      <Card style={{ opacity: 0.6 }}>
        <Text>hello</Text>
      </Card>
    );

    expect(getByText('hello')).toBeTruthy();
  });

  it.each(Object.keys(CARD_STATUS_COLOR) as CardStatus[])(
    'maps status "%s" to its token colour',
    async (status) => {
      const { getByTestId } = await render(
        <Card status={status}>
          <Text>content</Text>
        </Card>
      );

      const stripe = getByTestId('card-stripe', { includeHiddenElements: true });
      const flat = StyleSheet.flatten(stripe.props.style);
      expect(flat.backgroundColor).toBe(CARD_STATUS_COLOR[status]);
    }
  );

  it('gives every status a distinct colour', () => {
    // If two statuses collapsed to the same colour, the "sortable by eye" guarantee the stripe
    // exists for would silently break.
    const colours = Object.values(CARD_STATUS_COLOR);
    expect(new Set(colours).size).toBe(colours.length);
  });
});
