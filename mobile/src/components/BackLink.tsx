/**
 * The way back out of a pushed screen.
 *
 * Both child stacks (`(child)/me` and `(child)/games`) run with `headerShown: false`, because the
 * screens draw their own large headings and a native header on top of that reads as a double title.
 * The cost is that nothing supplies a back affordance, and five of the six screens behind those two
 * tabs shipped without one: a child who opened Notifications from the Me hub could only leave via
 * Android's system back gesture, and React Navigation remembers each tab's stack, so the Me tab then
 * opened on Notifications every time. That was reported as "the Me page opens notifications".
 *
 * So: an explicit control, on every screen that can be pushed. `minTouchTarget` tall rather than
 * text-sized, because the audience is children and a 14px tap target at the top of a screen is not one.
 *
 * The label names the destination ("Back to Me") rather than saying "Back", because a child arriving
 * from a toast or a deep link has no memory of a journey to reverse.
 */
import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { AppText } from '@/components/AppText';
import { fontSize, minTouchTarget, spacing, useTheme } from '@/theme';

export function BackLink({ label, href }: { label: string; href?: string }) {
  const theme = useTheme();

  return (
    <Pressable
      // `href` when given, so the control works even on a screen reached without a history entry to
      // pop: a notification deep link, or the first screen after a cold start. `router.back()` on an
      // empty stack does nothing at all, which is the failure this guards against.
      onPress={() => (href ? router.navigate(href) : router.back())}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.row}
    >
      <AppText style={[styles.label, { color: theme.mutedForeground }]}>‹ {label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: minTouchTarget, justifyContent: 'center', marginBottom: spacing[2] },
  label: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
});
