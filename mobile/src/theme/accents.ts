/**
 * Accent surfaces for the child app: the tinted tiles and the gradient headers.
 *
 * The child screens used to be two apps. Home and Games had gradients, emoji and colour; Tasks,
 * Rewards and the Me screens were white cards with grey buttons, so moving between tabs felt like
 * switching products. Every child screen now draws its colour from this one table, so a screen cannot
 * invent a shade the others do not use.
 *
 * ## The contrast rules these pairs were picked against
 *
 * Measured with the WCAG 2.1 formula, not eyeballed:
 *
 * - **Tints** are a `100` fill under a `700` ink from the same ramp, the pair `StatTile`, `Chip` and the
 *   games grid already use. Every ink clears 4.5:1 on its fill except `peach` (700 on 100 is 4.30:1),
 *   which is why peach text uses `textInk` (800) while its icons keep the brighter 700.
 * - **Gradients** carry text at every point along them, so the ink is checked against the LIGHTEST
 *   stop for dark ink and the lightest stop for white. `brand` moved one step darker than the old home
 *   hero (xp 600/500 to 700/600): white on xp 500 is 3.96:1 and failed for anything below large text.
 *   White on xp 600 is 5.38:1, teal 600 is 6.23:1, success 700 is 5.02:1. Gold uses 900 ink (5.66:1 on
 *   gold 400), peach uses 900 (5.01:1 on peach 300).
 *
 * All of these are fixed brand surfaces, deliberately independent of `useTheme()`, for the reason given
 * in `StatTile.tsx`: a subject's colour is part of its identity and does not dim in dark mode.
 */
import { palette, themes } from '@taskbuddy/shared';

export type AccentTone = 'xp' | 'gold' | 'success' | 'primary' | 'peach' | 'warning' | 'destructive';

export interface TintPair {
  /** The tile's background. */
  fill: string;
  /** Icons and large glyphs on the fill. */
  ink: string;
  /** Body-size text on the fill. Same as `ink` except where `ink` falls under 4.5:1. */
  textInk: string;
}

export const TINT: Record<AccentTone, TintPair> = {
  xp: { fill: palette.xp[100], ink: palette.xp[700], textInk: palette.xp[700] },
  gold: { fill: palette.gold[100], ink: palette.gold[700], textInk: palette.gold[800] },
  success: { fill: palette.success[100], ink: palette.success[700], textInk: palette.success[800] },
  primary: { fill: palette.primary[100], ink: palette.primary[700], textInk: palette.primary[700] },
  peach: { fill: palette.peach[100], ink: palette.peach[700], textInk: palette.peach[800] },
  warning: { fill: palette.warning[100], ink: palette.warning[700], textInk: palette.warning[800] },
  destructive: { fill: palette.destructive[100], ink: palette.destructive[700], textInk: palette.destructive[700] },
};

export type GradientTone = 'brand' | 'teal' | 'success' | 'gold' | 'peach';

export interface GradientSpec {
  /** Stops for `expo-linear-gradient`, drawn top-left to bottom-right. */
  colors: readonly [string, string, ...string[]];
  /** Every piece of text and every icon on the gradient. */
  ink: string;
  /** An icon drawn inside the header's white badge, so the glyph keeps the tone's colour. */
  badgeInk: string;
}

/** The white used on dark gradients. Same literal as `onGradient` in `theme/index.ts`. */
const WHITE = themes.light.primaryForeground;

export const GRADIENT: Record<GradientTone, GradientSpec> = {
  brand: { colors: [palette.xp[700], palette.xp[600], palette.primary[600]], ink: WHITE, badgeInk: palette.xp[700] },
  teal: { colors: [palette.primary[600], palette.primary[700]], ink: WHITE, badgeInk: palette.primary[700] },
  success: { colors: [palette.success[700], palette.primary[600]], ink: WHITE, badgeInk: palette.success[700] },
  gold: { colors: [palette.gold[300], palette.gold[400]], ink: palette.gold[900], badgeInk: palette.gold[700] },
  peach: { colors: [palette.peach[200], palette.peach[300]], ink: palette.peach[900], badgeInk: palette.peach[700] },
};
