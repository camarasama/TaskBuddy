/**
 * Game subject and level colours.
 *
 * Moved out of the game picker so Past games can show a session in its subject's colour too. A child
 * who learned "maths is purple" on the picker should find the same purple on their history, or the
 * colour stops meaning the subject.
 *
 * Every tint is a `100` fill under a `700` ink from one ramp, the pair the redesign spec fixes for
 * surfaces that must read the same in light and dark mode.
 */
import { palette } from '@taskbuddy/shared';
import type { GameCategory, GameLevel } from '@taskbuddy/shared';

/**
 * A tint pair, written as a pair rather than a ramp name so the two can never be taken from different
 * steps by accident.
 */
export interface Tint {
  fill: string;
  ink: string;
}

/**
 * Each subject's colour. Six ramps for six categories, chosen to be distinguishable by hue alone.
 *
 * `destructive` appears here as a plain coral, not as an error signal: at the `100`/`700` pair it is a
 * warm red band with an emoji on it, and the picker uses red for nothing else. The alternative was a
 * second amber, which would have made Grammar and Vocabulary the same card.
 */
export const CATEGORY_TINT: Record<GameCategory, Tint> = {
  maths: { fill: palette.xp[100], ink: palette.xp[700] },
  science: { fill: palette.success[100], ink: palette.success[700] },
  geography: { fill: palette.primary[100], ink: palette.primary[700] },
  vocabulary: { fill: palette.peach[100], ink: palette.peach[700] },
  grammar: { fill: palette.destructive[100], ink: palette.destructive[700] },
  puzzle: { fill: palette.gold[100], ink: palette.gold[700] },
};

/**
 * Each level's colour, matching the web lobby's badges exactly (`LEVEL_STYLE` in
 * `frontend/src/app/child/games/page.tsx`). Not per-category: the level colours mean "how hard".
 */
export const LEVEL_TINT: Record<GameLevel, Tint> = {
  beginner: { fill: palette.success[100], ink: palette.success[700] },
  intermediate: { fill: palette.warning[100], ink: palette.warning[700] },
  hard: { fill: palette.xp[100], ink: palette.xp[700] },
};
