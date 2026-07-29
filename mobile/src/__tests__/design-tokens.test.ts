/**
 * Invariants for the shared design tokens.
 *
 * Lives in `mobile/` rather than `shared/` because shared has no test runner, and mobile is the
 * consumer with the unforgiving requirements: React Native takes unitless numbers for every
 * dimension, and a string or an `undefined` does not throw — it silently drops the style. A missing
 * ramp step renders invisible text; a `'16px'` where a `16` belongs collapses a layout. Those are
 * expensive to find on a device and trivial to catch here.
 *
 * Resolves `@taskbuddy/shared` to source via the moduleNameMapper in `jest.config.js`, the same
 * source-not-dist rule Metro uses.
 */

import {
  COLOR_STEPS,
  fontSize,
  fontWeight,
  glow,
  minTouchTarget,
  palette,
  radius,
  rem,
  remScale,
  spacing,
  themes,
} from '@taskbuddy/shared';

const HEX = /^#[0-9a-f]{6}$/;

describe('colour ramps', () => {
  it.each(Object.keys(palette))('%s defines every step as a 6-digit hex', (name) => {
    const ramp = palette[name as keyof typeof palette];
    for (const step of COLOR_STEPS) {
      // Indexed rather than compared against a key list, because the failure being guarded is a
      // *missing* step, which a key-set comparison reports less legibly.
      expect(ramp[step]).toMatch(HEX);
    }
  });

  it('uses lowercase hex throughout, so string comparisons are safe', () => {
    const all = Object.values(palette).flatMap((ramp) => Object.values(ramp));
    expect(all.filter((c) => c !== c.toLowerCase())).toEqual([]);
  });
});

describe('semantic themes', () => {
  it('define exactly the same roles in light and dark', () => {
    // The classic dark-mode bug: a role is added to one theme and forgotten in the other, so the
    // app renders `undefined` for it in exactly one appearance.
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  it.each(['light', 'dark'] as const)('%s resolves every role to a colour', (name) => {
    // Offenders are collected rather than asserted in the loop so a failure names every bad role at
    // once instead of stopping at the first.
    const bad = Object.entries(themes[name])
      .filter(([, value]) => typeof value !== 'string' || !/^#[0-9a-f]{3,8}$/.test(value))
      .map(([role, value]) => `${role}=${String(value)}`);
    expect(bad).toEqual([]);
  });
});

describe('dimensional tokens are numbers, not CSS strings', () => {
  // The single rule that keeps these usable from React Native.
  const scales = { spacing, radius };

  it.each(Object.keys(scales))('%s holds finite numbers', (name) => {
    const scale = scales[name as keyof typeof scales] as Record<string, unknown>;
    const bad = Object.entries(scale)
      .filter(([, value]) => typeof value !== 'number' || !Number.isFinite(value))
      .map(([key, value]) => `${key}=${String(value)}`);
    expect(bad).toEqual([]);
  });

  it('gives every type step a numeric size and an explicit line height', () => {
    // Omitting lineHeight on RN <Text> yields font-dependent spacing that will not match the web,
    // so every step must carry one, and it must leave room for the glyphs.
    const bad = Object.entries(fontSize)
      .filter(
        ([, step]) =>
          typeof step.fontSize !== 'number' ||
          typeof step.lineHeight !== 'number' ||
          step.lineHeight < step.fontSize
      )
      .map(([key]) => key);
    expect(bad).toEqual([]);
  });

  it('expresses font weights as strings, which is what RN accepts', () => {
    for (const value of Object.values(fontWeight)) {
      expect(value).toMatch(/^[1-9]00$/);
    }
  });
});

describe('rem conversion', () => {
  it('converts against a 16px baseline', () => {
    expect(rem(16)).toBe('1rem');
    expect(rem(24)).toBe('1.5rem');
    expect(rem(4)).toBe('0.25rem');
  });

  it('emits 0px for zero, matching what Tailwind generates', () => {
    // Not cosmetic: it is what keeps the compiled stylesheet byte-identical to the hand-written
    // config these tokens replaced, so a regression is a one-line CSS diff rather than a hunt.
    expect(rem(0)).toBe('0px');
  });

  it('preserves keys across a whole scale', () => {
    expect(Object.keys(remScale(spacing))).toEqual(Object.keys(spacing));
    expect(remScale(spacing)[4]).toBe('1rem');
  });

  it('would mangle the `full` radius sentinel, which is why the web special-cases it', () => {
    // Documents the trap rather than leaving the next person to rediscover it: `full` is "as round
    // as the box allows", not a length. See the note on it in the tokens and its override in
    // frontend/tailwind.config.ts.
    expect(rem(radius.full)).toBe('624.9375rem');
    expect(radius.full).toBeGreaterThan(1000);
  });
});

describe('accessibility floors', () => {
  it('keeps the minimum touch target at 44dp or more', () => {
    // Google's accessibility checks and Play's Families review both look at this, and the web
    // already enforces it globally in globals.css.
    expect(minTouchTarget).toBeGreaterThanOrEqual(44);
  });

  /** WCAG 2.1 relative luminance. */
  function luminance(hex: string): number {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  /**
   * Body-text pairings only. Measured ratios, light / dark:
   *
   *   foreground on appBackground        17.06 / 17.06
   *   foreground on background           17.85 / 17.06
   *   cardForeground on card             17.85 / 13.98
   *   mutedForeground on appBackground    4.55 / 6.96   ← light passes by 0.05
   *   mutedForeground on card             4.76 / 5.71
   *
   * `mutedForeground` in light mode clears AA by a hair. That is not slack to spend: darkening the
   * backdrop or lightening slate-500 even one step drops it below 4.5 and this test will say so.
   *
   * **Deliberately excluded — two pairs that already fail AA on the web today:**
   *
   *   primaryForeground on primary        2.77 / 8.33
   *   destructiveForeground on destructive 3.76 / 3.76
   *
   * White on primary-500 and white on red-500 are pre-existing properties of `.btn-primary` and the
   * destructive styles, not something these tokens introduced — the compiled CSS is unchanged.
   * Asserting them would fail on day one. Both clear the 3:1 bar for *large* text, so button labels
   * at 18px+ bold are compliant; small labels are not. Fixing it means moving a brand colour, which
   * is a design decision, so it belongs to the Phase 3 accessibility pass.
   */
  const pairs: readonly [keyof typeof themes.light, keyof typeof themes.light][] = [
    ['foreground', 'appBackground'],
    ['foreground', 'background'],
    ['cardForeground', 'card'],
    ['mutedForeground', 'appBackground'],
    ['mutedForeground', 'card'],
  ];

  it.each(['light', 'dark'] as const)('%s meets AA (4.5:1) for body text', (name) => {
    const theme = themes[name];
    const failing = pairs
      .map(([fg, bg]) => ({ pair: `${fg} on ${bg}`, ratio: contrast(theme[fg], theme[bg]) }))
      .filter(({ ratio }) => ratio < 4.5)
      .map(({ pair, ratio }) => `${pair} = ${ratio.toFixed(2)}:1`);
    expect(failing).toEqual([]);
  });

  it('sanity-checks the contrast helper against known extremes', () => {
    // A broken helper that returns a large number for everything would make the test above
    // vacuous, so pin both ends of the scale.
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('glow effects', () => {
  it('are colours only, so each platform composes its own shadow geometry', () => {
    for (const value of Object.values(glow)) {
      expect(value).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
    }
  });
});
