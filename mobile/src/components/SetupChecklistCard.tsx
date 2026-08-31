/**
 * The parent dashboard's way back into the setup wizard.
 *
 * Ported from `frontend/src/components/SetupChecklistCard.tsx`. The wizard itself
 * (`app/(parent)/welcome.tsx`) has existed on mobile since U6, but until this card the only route to
 * it was `register.tsx`, once, immediately after account creation. A parent who skipped it, closed
 * the app part-way through, or was handed an existing family by a co-parent never saw it again, and
 * the app looked to them like it had no onboarding at all. Testers reported exactly that.
 *
 * ## Renders nothing more often than it renders
 *
 * Absent while loading, on a failed fetch, once every step is done, and when the parent dismissed it.
 * A dashboard must not flash a setup banner at someone who already finished, and a failed request for
 * a nudge must not push the real content down the screen. Failure is silent for the same reason the
 * web version's is: nobody needs a toast telling them a suggestion did not load.
 *
 * ## Why it needs no refresh wiring of its own
 *
 * `welcome.tsx` writes progress straight into the shared cache with
 * `queryClient.setQueryData(ONBOARDING_KEY, ...)`. Both screens read the same key, so finishing a step
 * in the wizard updates this card without it refetching, and without the dashboard remounting, which
 * matters because these screens are tabs and a tab that has been mounted stays mounted (see
 * `lib/useFreshOnFocus.ts`).
 */
import { View, Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { ProgressBar } from '@/components/ProgressBar';
import { ONBOARDING_STEPS, onboardingQuery } from '@/lib/onboardingApi';
import { plural } from '@/lib/plural';
import { fontSize, fontWeight, minTouchTarget, spacing, useTheme } from '@/theme';

const TOTAL_STEPS = ONBOARDING_STEPS.length;

export function SetupChecklistCard() {
  const theme = useTheme();
  // No error branch below reads this, so the query is left to fail quietly rather than being given a
  // retry the parent never asked for.
  const { data } = useQuery(onboardingQuery());

  if (!data || data.state.dismissed || data.isComplete) return null;

  const completed = data.state.completedSteps.length;
  // `isComplete` is the server's own judgement and is what gates the card above. This is belt and
  // braces for a future step being added to ONBOARDING_STEPS ahead of the backend agreeing.
  if (completed >= TOTAL_STEPS) return null;

  const remaining = TOTAL_STEPS - completed;

  return (
    <Pressable
      onPress={() => router.push('/(parent)/welcome')}
      accessibilityRole="button"
      // The whole card is one tap, so it is one stop for a screen reader, and the label has to carry
      // everything the sighted version shows: what it is, how far along, and what happens next.
      accessibilityLabel={`Finish setting up TaskBuddy. ${completed} of ${TOTAL_STEPS} steps done.`}
      accessibilityHint="Opens the setup guide"
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <Card status="info">
        <View style={styles.row}>
          <Ionicons
            name="sparkles"
            size={ICON_SIZE}
            color={theme.primary}
            importantForAccessibility="no"
            accessibilityElementsHidden
          />
          <View style={styles.text}>
            <AppText style={[styles.title, { color: theme.cardForeground }]}>
              {completed === 0 ? 'Finish setting up TaskBuddy' : 'Nearly there'}
            </AppText>
            <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
              {plural(remaining, 'step')} to go. Pick up where you left off.
            </AppText>
          </View>
          <Ionicons
            name="chevron-forward"
            size={ICON_SIZE}
            color={theme.mutedForeground}
            importantForAccessibility="no"
            accessibilityElementsHidden
          />
        </View>

        {/* Hidden from the screen reader, not because it is decorative but because the card's own
            label already says "2 of 4 steps done". Left visible, the bar is a second focus stop
            repeating it, and ProgressBar is `accessible` by design so it cannot be quietened from
            its own props. */}
        <View
          style={styles.progress}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <ProgressBar
            percent={(completed / TOTAL_STEPS) * 100}
            variant="completion"
            label="Setup progress"
          />
        </View>
      </Card>
    </Pressable>
  );
}

/** Matches the dashboard's other row glyphs. */
const ICON_SIZE = 22;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: minTouchTarget,
  },
  text: { flex: 1 },
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  detail: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[1],
  },
  progress: { marginTop: spacing[3] },
});
