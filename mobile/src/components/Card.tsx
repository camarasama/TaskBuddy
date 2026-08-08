/**
 * Surface container.
 *
 * Mirrors the web's `.card`: the `card` colour sits on the `appBackground` one, which is why the
 * tokens carry both (on the web `--background` is white while the body is slate-50, so a card is
 * white *against* off-white). Using `background` here instead would render white on white and lose all
 * card definition. See the note on `themes` in the tokens.
 *
 * The redesign drops the 1px border in favour of elevation (see `theme/elevation.ts`) and adds an
 * optional `status` stripe. Both are additive: a caller passing only `children` and `style`, which is
 * every one of the roughly 40 existing call sites, renders exactly as before minus the border and
 * plus a shadow.
 *
 * ## Why this is two nested views, not one
 *
 * `elevation` (the iOS shadow properties plus Android's `elevation` number) has to live on the same
 * view as `backgroundColor` and `borderRadius`, or Android computes the shadow's outline from an
 * unfilled rectangle and draws a square shadow under a rounded card. That same view cannot also set
 * `overflow: 'hidden'`, because on iOS `overflow: 'hidden'` becomes `clipsToBounds`, which clips the
 * shadow layer itself: a card with a status stripe would then have no shadow while every other card
 * kept its shadow, an inconsistency that would be maddening to track back to `overflow`. The inner
 * view exists only to clip the stripe's square corners to the card's rounding; it carries no shadow
 * of its own so clipping it costs nothing.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { elevation, palette, radius, spacing, useTheme } from '@/theme';

export type CardStatus = 'pending' | 'done' | 'late' | 'info';

/**
 * Stripe colour per status. Pending/done/late mirror the task-state colours used everywhere else in
 * the app (approvals, task rows); `info` is the fallback for a card that needs a coloured edge
 * without being a task-state, e.g. an unread notice.
 */
export const CARD_STATUS_COLOR: Record<CardStatus, string> = {
  pending: palette.warning[500],
  done: palette.success[500],
  late: palette.destructive[500],
  info: palette.primary[500],
};

interface CardProps {
  children: ReactNode;
  /** Merged last, so a caller can emphasise a card (a coloured background for something urgent). */
  style?: ViewStyle;
  /**
   * Renders a 4px stripe down the left edge, encoding assignment state so a list of cards reads
   * sortable by eye rather than requiring each one to be read. Omitted entirely, not just
   * transparent, when no status is passed: that is the backwards-compatibility guarantee for the
   * existing callers.
   */
  status?: CardStatus;
}

const STRIPE_WIDTH = 4;

export function Card({ children, style, status }: CardProps) {
  const theme = useTheme();

  return (
    <View style={[styles.surface, elevation.card, { backgroundColor: theme.card }, style]}>
      <View style={[styles.clip, status ? styles.paddingWithStripe : styles.padding]}>
        {status && (
          <View
            testID="card-stripe"
            style={[styles.stripe, { backgroundColor: CARD_STATUS_COLOR[status] }]}
            // The stripe is the information (it says pending/done/late/info); a screen reader has
            // nothing useful to announce for a bare coloured bar, so it is hidden rather than read
            // as an unlabelled image. Screens that need the state spoken aloud say so in their own
            // accessibilityLabel for the card's content.
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        )}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    // radius.lg (16), not xl (24). 16 is exactly Tailwind's `rounded-2xl`, the roundest card the web
    // uses, and the web's own cards are mostly rounded-lg/xl (8 and 12). A 24dp card is rounder than
    // anything on the web and the two clients would visibly disagree.
    borderRadius: radius.lg,
    marginBottom: spacing[4],
  },
  clip: {
    // radius.lg (16), not xl (24). 16 is exactly Tailwind's `rounded-2xl`, the roundest card the web
    // uses, and the web's own cards are mostly rounded-lg/xl (8 and 12). A 24dp card is rounder than
    // anything on the web and the two clients would visibly disagree.
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  padding: {
    padding: spacing[4],
  },
  paddingWithStripe: {
    // Left padding grows by exactly the stripe's width so the stripe sits in its own lane instead of
    // eating into the text's margin.
    paddingTop: spacing[4],
    paddingRight: spacing[4],
    paddingBottom: spacing[4],
    paddingLeft: spacing[4] + STRIPE_WIDTH,
  },
  stripe: {
    // Absolute against the clipped view's full box, not its padded content box, so padding above
    // does not shrink or offset it.
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: STRIPE_WIDTH,
  },
});
