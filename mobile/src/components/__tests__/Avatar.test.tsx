import { render } from '@testing-library/react-native';

import { Avatar, avatarGradientIndex } from '@/components/Avatar';

// Same reason as StatTile.test.tsx: importing AppText pulls in expo-font, which this monorepo's npm
// install cannot resolve expo-asset for. See that file for the full explanation.
jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));

describe('avatarGradientIndex', () => {
  it('is deterministic: the same seed always maps to the same index', () => {
    const a = avatarGradientIndex('child-123');
    const b = avatarGradientIndex('child-123');
    expect(a).toBe(b);
  });

  it('stays within the three-gradient cycle for a range of seeds', () => {
    const seeds = ['a', 'child-1', 'child-2', 'a-much-longer-uuid-style-identifier-0000'];
    for (const seed of seeds) {
      const index = avatarGradientIndex(seed);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(3);
    }
  });

  it('gives at least two different seeds different indices, so the cycle is not collapsed to one value', () => {
    const indices = new Set(['alice', 'bob', 'carol', 'dave', 'erin'].map(avatarGradientIndex));
    expect(indices.size).toBeGreaterThan(1);
  });
});

describe('Avatar', () => {
  it('renders the first letter of the name, upper-cased', async () => {
    const { getByText } = await render(<Avatar seed="child-1" name="maya" />);

    expect(getByText('M')).toBeTruthy();
  });

  it('falls back to a placeholder glyph for an empty name rather than rendering nothing', async () => {
    const { getByText } = await render(<Avatar seed="child-1" name="" />);

    expect(getByText('?')).toBeTruthy();
  });

  it('exposes the full name as its accessibility label', async () => {
    const { getByLabelText } = await render(<Avatar seed="child-1" name="Maya" />);

    expect(getByLabelText('Maya')).toBeTruthy();
  });

  it('gives the same seed the same rendered gradient colours across two separate renders', async () => {
    const first = await render(<Avatar seed="same-child" name="Maya" />);
    const firstColours = first.getByTestId('avatar-gradient').props.colors;
    await first.unmount();

    const second = await render(<Avatar seed="same-child" name="Maya" />);
    const secondColours = second.getByTestId('avatar-gradient').props.colors;
    await second.unmount();

    expect(secondColours).toEqual(firstColours);
  });

  it('gives a different seed a different gradient, at least for one of two well-separated seeds', async () => {
    const a = await render(<Avatar seed="child-a" name="A" />);
    const aColours = a.getByTestId('avatar-gradient').props.colors;
    await a.unmount();

    const b = await render(<Avatar seed="child-b-a-fairly-different-string" name="B" />);
    const bColours = b.getByTestId('avatar-gradient').props.colors;
    await b.unmount();

    expect(bColours).not.toEqual(aColours);
  });
});
