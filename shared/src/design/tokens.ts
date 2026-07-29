/**
 * Design tokens — the single source of truth for colour, spacing, radii and type across the web
 * frontend and the React Native app.
 *
 * ## The unit rule, which is the whole reason this file is shaped the way it is
 *
 * Every dimensional token here is a **plain number meaning density-independent pixels**. React
 * Native accepts only unitless numbers for `fontSize`, `padding`, `borderRadius` and friends; CSS
 * wants `rem`. Storing `'1rem'` would force the app to parse strings at runtime, and storing both
 * would let them drift. So: numbers are canonical, and the web converts on the way in via `rem()`
 * at Tailwind-config load time. Never add a token whose value is a CSS-only string unless it is
 * explicitly namespaced as web-only.
 *
 * The 16px baseline is the assumption that makes the conversion valid — it matches the browser
 * default and Tailwind's own scale, so `rem(16) === '1rem'`.
 *
 * ## Provenance
 *
 * These values were extracted from what the web already shipped, not designed fresh:
 * the ramps and radii from `frontend/tailwind.config.ts`, the semantic light/dark pairs from the
 * CSS custom properties in `frontend/src/styles/globals.css`. Changing a value here changes both
 * clients, which is the point — but it does mean a careless edit is a visual regression on the web.
 *
 * `slate` and `destructive` are carried here even though Tailwind ships them by default: React
 * Native has no default palette, so the app cannot render a border or a body of text without them.
 */

// ─── Colour ──────────────────────────────────────────────────────────────────

/** The steps every colour ramp defines. Uniform so a ramp can be indexed generically. */
export const COLOR_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

export type ColorStep = (typeof COLOR_STEPS)[number];

/** A full ramp. Every ramp in `palette` satisfies this, which the token tests assert. */
export type ColorRamp = Record<ColorStep, string>;

/**
 * Raw colour ramps. Semantic meaning lives in `themes` below — prefer that for anything
 * chrome-related, and reach into a ramp directly only for the gamification accents (points, XP)
 * where the colour *is* the meaning.
 */
export const palette = {
  /** Brand. Friendly blue; also the focus-ring and primary-action colour. */
  primary: {
    50: '#f0f9ff',
    100: '#e0f2fe',
    200: '#bae6fd',
    300: '#7dd3fc',
    400: '#38bdf8',
    500: '#0ea5e9',
    600: '#0284c7',
    700: '#0369a1',
    800: '#075985',
    900: '#0c4a6e',
  },
  /** Completion / approval. */
  success: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
  },
  /** Pending / awaiting-approval. */
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },
  /** Points and rewards. */
  gold: {
    50: '#fefce8',
    100: '#fef9c3',
    200: '#fef08a',
    300: '#fde047',
    400: '#facc15',
    500: '#eab308',
    600: '#ca8a04',
    700: '#a16207',
    800: '#854d0e',
    900: '#713f12',
  },
  /** XP and levelling. */
  xp: {
    50: '#faf5ff',
    100: '#f3e8ff',
    200: '#e9d5ff',
    300: '#d8b4fe',
    400: '#c084fc',
    500: '#a855f7',
    600: '#9333ea',
    700: '#7e22ce',
    800: '#6b21a8',
    900: '#581c87',
  },
  /** Neutrals. Matches Tailwind's `slate` exactly — do not diverge, the web relies on it. */
  slate: {
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
  /** Errors and destructive actions. Matches Tailwind's `red`. */
  destructive: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
  },
} as const satisfies Record<string, ColorRamp>;

export type PaletteName = keyof typeof palette;

// ─── Semantic theme ──────────────────────────────────────────────────────────

/**
 * Role-based colours for one appearance. Mirrors the CSS custom properties in `globals.css`
 * one-to-one, so a value looked up here is the value the web renders.
 */
export interface SemanticTheme {
  /** The page/screen backdrop. NOT the same as `background` — see the note on `themes`. */
  appBackground: string;
  /** Surface colour for content sitting directly on the backdrop. */
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  /** Focus indicator. Must stay distinguishable against `appBackground` in both themes. */
  ring: string;
}

/**
 * Light and dark values for every semantic role.
 *
 * `appBackground` deserves a word: on the web `--background` is pure white while `body` is
 * `bg-slate-50`, so the actual backdrop is one step off-white and cards are white *against* it.
 * A native screen that used `background` for the screen and `card` for cards would render
 * white-on-white and lose all card definition. `appBackground` is that missing value, named
 * rather than rediscovered per screen.
 */
export const themes = {
  light: {
    appBackground: palette.slate[50],
    background: '#ffffff',
    foreground: palette.slate[900],
    card: '#ffffff',
    cardForeground: palette.slate[900],
    primary: palette.primary[500],
    primaryForeground: '#ffffff',
    secondary: palette.slate[100],
    secondaryForeground: palette.slate[900],
    muted: palette.slate[100],
    mutedForeground: palette.slate[500],
    accent: palette.slate[100],
    accentForeground: palette.slate[900],
    destructive: palette.destructive[500],
    destructiveForeground: '#ffffff',
    border: palette.slate[200],
    input: palette.slate[200],
    ring: palette.primary[500],
  },
  dark: {
    appBackground: palette.slate[900],
    background: palette.slate[900],
    foreground: palette.slate[50],
    card: palette.slate[800],
    cardForeground: palette.slate[50],
    // Lightened one step: primary-500 on a slate-900 field is under 3:1 and fails on a phone
    // outdoors, which is where a lot of this app is actually used.
    primary: palette.primary[400],
    primaryForeground: palette.slate[900],
    secondary: palette.slate[700],
    secondaryForeground: palette.slate[50],
    muted: palette.slate[700],
    mutedForeground: palette.slate[400],
    accent: palette.slate[700],
    accentForeground: palette.slate[50],
    destructive: palette.destructive[500],
    destructiveForeground: '#ffffff',
    border: palette.slate[700],
    input: palette.slate[700],
    ring: palette.primary[400],
  },
} as const satisfies Record<'light' | 'dark', SemanticTheme>;

export type ThemeName = keyof typeof themes;

// ─── Spacing ─────────────────────────────────────────────────────────────────

/**
 * 4px-based scale, keyed to match Tailwind's numbering (`spacing[4]` is Tailwind's `p-4`).
 * Values are dp — see the unit rule at the top.
 */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

export type SpacingKey = keyof typeof spacing;

// ─── Radii ───────────────────────────────────────────────────────────────────

/**
 * Corner radii in dp. `lg`/`xl`/`2xl` are deliberately much rounder than Tailwind's defaults —
 * that override is pre-existing and is a large part of the app's soft, kid-friendly look.
 */
export const radius = {
  none: 0,
  sm: 2,
  base: 4,
  md: 6,
  lg: 16,
  xl: 24,
  '2xl': 32,
  /**
   * Sentinel, not a measurement: "as round as the box allows" — the pill/circle radius.
   *
   * It is a real dp value on native (RN clamps it to half the shorter side), but it must NOT be
   * unit-converted for the web: `rem(9999)` yields `624.9375rem`, which scales with the root font
   * size and is nonsense to read. The web maps this key to `9999px` explicitly — see
   * `frontend/tailwind.config.ts`. Any other consumer converting this scale must special-case it.
   */
  full: 9999,
} as const;

export type RadiusKey = keyof typeof radius;

// ─── Typography ──────────────────────────────────────────────────────────────

/**
 * Type scale. Each step carries its line height because React Native will not compute one:
 * omitting `lineHeight` on RN `Text` yields font-dependent spacing that differs from the web.
 */
export interface TypeStep {
  /** dp */
  fontSize: number;
  /** dp */
  lineHeight: number;
}

export const fontSize = {
  xs: { fontSize: 12, lineHeight: 16 },
  sm: { fontSize: 14, lineHeight: 20 },
  base: { fontSize: 16, lineHeight: 24 },
  lg: { fontSize: 18, lineHeight: 28 },
  xl: { fontSize: 20, lineHeight: 28 },
  '2xl': { fontSize: 24, lineHeight: 32 },
  '3xl': { fontSize: 30, lineHeight: 36 },
  '4xl': { fontSize: 36, lineHeight: 40 },
  '5xl': { fontSize: 48, lineHeight: 48 },
} as const satisfies Record<string, TypeStep>;

export type FontSizeKey = keyof typeof fontSize;

/** Strings, because that is what React Native's `fontWeight` accepts. CSS takes them too. */
export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export type FontWeightKey = keyof typeof fontWeight;

/**
 * Logical font family names, which each platform resolves its own way: the web maps them to the
 * `next/font` CSS variables, and the app must load the same two families through `expo-font`
 * before referencing them.
 *
 * Until that loading step exists in the app, native text falls back to the system face — which
 * looks fine and is easy to miss in review. Treat a screen as unstyled-by-default rather than
 * assuming these names resolve.
 */
export const fontFamily = {
  sans: 'Inter',
  display: 'Poppins',
} as const;

export type FontFamilyKey = keyof typeof fontFamily;

// ─── Accessibility ───────────────────────────────────────────────────────────

/**
 * Minimum hit target in dp for anything interactive.
 *
 * The web enforces this globally in `globals.css` ("better touch targets for children"). Native
 * has no equivalent global hook, so every touchable has to apply it itself. It is also the floor
 * both Material and Google's own accessibility checks use, and Play's Families review does look
 * at it — so this is a requirement, not a preference.
 */
export const minTouchTarget = 44;

// ─── Effects ─────────────────────────────────────────────────────────────────

/**
 * Glow colours, as `rgba()` strings ready to drop into a shadow.
 *
 * Only the *colour* is shared. Shadow geometry is not: CSS `box-shadow` and RN's
 * `shadowOffset`/`elevation` are not expressible in each other's terms, and pretending otherwise
 * produces a token that is subtly wrong on one platform. Each client composes its own shadow from
 * these colours — Tailwind builds the `box-shadow` strings in `tailwind.config.ts`.
 */
export const glow = {
  primary: 'rgba(14, 165, 233, 0.3)',
  success: 'rgba(34, 197, 94, 0.3)',
  gold: 'rgba(234, 179, 8, 0.3)',
  xp: 'rgba(168, 85, 247, 0.3)',
} as const;

export type GlowKey = keyof typeof glow;

// ─── Web interop ─────────────────────────────────────────────────────────────

/**
 * dp → `rem`, against the 16px baseline. `rem(24)` is `'1.5rem'`.
 *
 * Zero returns `'0px'`, not `'0'`. Both are valid CSS and render identically; `'0px'` is what
 * Tailwind's own scale emits, and matching it keeps the generated stylesheet byte-identical to
 * the hand-written config this replaced — which is what makes "no visual change" verifiable by
 * diffing the CSS rather than by eyeballing screens.
 */
export function rem(px: number): string {
  if (px === 0) return '0px';
  return `${px / 16}rem`;
}

/**
 * `rem()` across a whole scale, preserving keys — for handing `spacing` or `radius` to Tailwind
 * in one expression instead of restating every key by hand (which is how scales drift).
 */
export function remScale<K extends PropertyKey>(scale: Record<K, number>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(scale) as K[]) {
    out[key] = rem(scale[key]);
  }
  return out;
}
