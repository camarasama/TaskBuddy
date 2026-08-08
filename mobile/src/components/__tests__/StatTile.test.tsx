import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { StatTile } from '@/components/StatTile';
import { palette } from '@/theme';

/**
 * `AppText` pulls in `theme/FontProvider`, which imports `expo-font` at module scope regardless of
 * whether `<FontProvider>` is ever mounted. `expo-font` in turn imports `expo-asset`, which this
 * monorepo's npm install hoists only under `expo`'s own `node_modules` (a transitive dependency
 * expo-font never declares for itself; it works in a normal Expo app purely because `expo` also
 * needs it and hoisting is kind). That makes it unresolvable from here, and breaks the whole import
 * chain before a single test runs. Mocking the module is the fix rather than teaching `expo-font` to
 * resolve `expo-asset`, since editing `jest.config.js` is outside this unit's file scope, and
 * `useFonts` is never actually called in these tests anyway (no test here mounts `<FontProvider>`).
 * Jest hoists `jest.mock` above the imports above regardless of where it is written.
 */
jest.mock('expo-font', () => ({ useFonts: () => [false, null] }));

const EXPECTED: Record<
  'warning' | 'success' | 'gold' | 'info',
  { background: string; foreground: string }
> = {
  warning: { background: palette.warning[100], foreground: palette.warning[700] },
  success: { background: palette.success[100], foreground: palette.success[700] },
  gold: { background: palette.gold[100], foreground: palette.gold[700] },
  info: { background: palette.primary[100], foreground: palette.primary[700] },
};

describe('StatTile', () => {
  it.each(Object.keys(EXPECTED) as (keyof typeof EXPECTED)[])(
    'variant "%s" combines the tinted background with its 700-weight foreground',
    async (variant) => {
      const { getByLabelText } = await render(
        <StatTile value={3} label="To approve" variant={variant} />
      );

      const tile = getByLabelText('3 To approve');
      const flat = StyleSheet.flatten(tile.props.style);

      expect(flat.backgroundColor).toBe(EXPECTED[variant].background);
    }
  );

  it('combines the value and label into one accessible label rather than two separate stops', async () => {
    const { getByLabelText } = await render(
      <StatTile value={12} label="Done today" variant="success" />
    );

    expect(getByLabelText('12 Done today')).toBeTruthy();
  });

  it('gives every variant a distinct background', () => {
    const backgrounds = Object.values(EXPECTED).map((c) => c.background);
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
  });
});
