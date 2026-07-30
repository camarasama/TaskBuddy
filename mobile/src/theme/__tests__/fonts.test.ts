/**
 * Font face resolution.
 *
 * This exists because of an Android behaviour, not a design preference: a custom `fontFamily` maps to
 * exactly the face registered under that name, and a `fontWeight` set alongside it is either ignored or
 * applied a *second* time as a synthetic bold. So semibold text renders as regular on one device and
 * double-bolded on another, and neither looks like the mock.
 *
 * The fix is to select the concrete per-weight face and drop `fontWeight` — which makes the mapping below
 * load-bearing rather than cosmetic.
 */
import { fontWeight } from '@taskbuddy/shared';

import { FONT_ASSETS, resolveFont } from '../fonts';

describe('resolveFont — sans (Inter)', () => {
  it('maps each token weight to its own face', () => {
    expect(resolveFont('sans', fontWeight.normal)).toBe('Inter_400Regular');
    expect(resolveFont('sans', fontWeight.medium)).toBe('Inter_500Medium');
    expect(resolveFont('sans', fontWeight.semibold)).toBe('Inter_600SemiBold');
    expect(resolveFont('sans', fontWeight.bold)).toBe('Inter_700Bold');
  });

  it('gives every weight a distinct face', () => {
    // If two weights collapsed to one face, the design would silently lose a level of hierarchy.
    const faces = Object.values(fontWeight).map((w) => resolveFont('sans', w));
    expect(new Set(faces).size).toBe(faces.length);
  });

  it('accepts a numeric weight, which React Native also allows', () => {
    expect(resolveFont('sans', 600)).toBe('Inter_600SemiBold');
  });

  it('defaults to regular when no weight is given', () => {
    expect(resolveFont('sans', undefined)).toBe('Inter_400Regular');
  });

  it('returns undefined for a weight we do not ship', () => {
    // Undefined means "leave the system font alone", which is better than a face whose metrics do not
    // match the rest of the screen.
    expect(resolveFont('sans', '300')).toBeUndefined();
    expect(resolveFont('sans', '900')).toBeUndefined();
  });
});

describe('resolveFont — display (Poppins)', () => {
  it('returns the single bold face for every weight', () => {
    /**
     * Only Poppins 700 ships: all 93 `font-display` usages in `frontend/src` are paired with `font-bold`
     * and nothing else. A heading asking for a lighter display weight gets bold rather than silently
     * dropping to the system font, which would be the more visible wrong answer.
     */
    expect(resolveFont('display', fontWeight.bold)).toBe('Poppins_700Bold');
    expect(resolveFont('display', fontWeight.semibold)).toBe('Poppins_700Bold');
    expect(resolveFont('display', fontWeight.normal)).toBe('Poppins_700Bold');
  });
});

describe('FONT_ASSETS', () => {
  it('ships exactly the five faces the app can reference', () => {
    // Any extra face is dead bytes in a bundle downloaded by families on metered data; any missing one is
    // a style naming a family that was never registered.
    expect(Object.keys(FONT_ASSETS).sort()).toEqual([
      'Inter_400Regular',
      'Inter_500Medium',
      'Inter_600SemiBold',
      'Inter_700Bold',
      'Poppins_700Bold',
    ]);
  });

  it('every resolvable face is actually loaded', () => {
    const loadable = new Set(Object.keys(FONT_ASSETS));
    const referenced = [
      ...Object.values(fontWeight).map((w) => resolveFont('sans', w)),
      ...Object.values(fontWeight).map((w) => resolveFont('display', w)),
    ].filter((f): f is string => f !== undefined);

    const missing = referenced.filter((f) => !loadable.has(f));
    expect(missing).toEqual([]);
  });
});
