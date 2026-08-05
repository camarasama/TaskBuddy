/**
 * The "you did it" moment.
 *
 * A short overlay that scales and fades in, holds, and leaves. Used when a child completes a task,
 * finishes a game or redeems a reward — the three moments where something they worked for actually
 * lands.
 *
 * ## Reanimated, and why that is not a new risk
 *
 * `react-native-reanimated` has an unhappy history here: a transitive copy at the wrong version
 * SIGSEGV'd in `libworklets.so` and cost Phase 0 four rounds. It is now a **direct** dependency pinned
 * at 4.5.1 with `react-native-worklets` 0.10.1 beside it, and `babel.config.js` lists the worklets
 * plugin explicitly rather than relying on the preset's auto-detection. It is already compiled into the
 * builds on the owner's phone, so this component adds no native surface at all — nothing here requires
 * a rebuild.
 *
 * ## Reduced motion is honoured, not decorated
 *
 * With "remove animations" on, the overlay appears and disappears with no movement — same information,
 * same timing, no scale or translation. It is not skipped: a child who has reduced motion enabled
 * should still be told they earned something. Families reviewers check accessibility, and this is the
 * one screen element that would otherwise animate.
 *
 * ## It never blocks
 *
 * `pointerEvents="none"` throughout, and it dismisses itself. A celebration that a child has to tap
 * away is a modal wearing a party hat, and it gets in the way of the next task.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { AppText } from '@/components/AppText';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

/** How long the message stays fully visible before fading. */
const HOLD_MS = 1400;
const FADE_MS = 220;

export function Celebration({
  message,
  detail,
  onDone,
}: {
  message: string;
  /** Optional second line — usually what was actually earned, e.g. "+3 points". */
  detail?: string;
  onDone: () => void;
}) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();

  const opacity = useSharedValue(0);
  const scale = useSharedValue(reduceMotion ? 1 : 0.85);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: FADE_MS });
    if (!reduceMotion) {
      scale.value = withTiming(1, { duration: FADE_MS });
    }

    opacity.value = withDelay(HOLD_MS, withTiming(0, { duration: FADE_MS }));

    /**
     * Dismissal is a plain timer rather than a `withTiming` completion callback.
     *
     * A callback would have to cross back from the UI thread via `runOnJS`, and if this component
     * unmounts first — the child navigates away mid-celebration, which is the common case — that
     * callback fires into a dead tree. A timer is cancellable from the cleanup below, so navigating
     * away simply stops it.
     */
    const timer = setTimeout(onDone, HOLD_MS + FADE_MS);
    return () => clearTimeout(timer);
    // Intentionally once per mount: the celebration is keyed by the caller, so a new message means a
    // new instance rather than a re-run of this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.View style={[styles.card, { backgroundColor: theme.card }, style]}>
        <AppText
          // Announced immediately: a child using a screen reader gets the same news at the same
          // moment, rather than a silent animation they never learn about.
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.message, { color: theme.foreground }]}
        >
          {message}
        </AppText>
        {detail && (
          <AppText style={[styles.detail, { color: theme.primary }]}>{detail}</AppText>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    // Written out rather than spreading `StyleSheet.absoluteFillObject`, which this RN version's types
    // do not expose on the StyleSheet namespace.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[5],
  },
  card: {
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[6],
    borderRadius: radius.lg,
    alignItems: 'center',
    // Enough lift to read as an overlay rather than as part of the page behind it.
    elevation: 8,
  },
  message: {
    fontSize: fontSize.xl.fontSize,
    lineHeight: fontSize.xl.lineHeight,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
  },
  detail: {
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.bold,
    marginTop: spacing[2],
  },
});
