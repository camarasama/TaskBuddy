/**
 * The guided setup wizard — ported from `frontend/src/app/parent/welcome/page.tsx` (growth roadmap
 * §3.2, U6).
 *
 * A parent landing on an empty dashboard has to invent the product for themselves, and the web build
 * measured that as the biggest activation drop-off. This mirrors the web's four steps, in the same
 * order, ending in the same engineered moment: step 4 seeds a task the child has "already finished"
 * and hands the parent the approve button, so both sides feel the real loop — real points, a real
 * socket event — inside the first minute rather than a day later. That is the point of this screen,
 * not decoration, so it is the one step that is never a plain "go somewhere else and come back".
 *
 * State is server-side (`FamilySettings.onboardingState` via `/onboarding`), so closing the app loses
 * nothing and a co-parent on another device sees the same checklist.
 *
 * ## Step 2 opens the template picker directly
 *
 * The web opens `/parent/tasks/new?templates=1` with the sheet already up. Mobile could not until the
 * parent visual pass gave `task-form.tsx` a `template=1` param (the Tasks header's "From a template"
 * uses it too), so this step now does the same as the web.
 *
 * ## One honest departure from the web
 *
 * **No confetti.** The web uses `react-confetti`; mobile has no equivalent lightweight dependency,
 *    and this unit adds none. The success feedback here is a themed banner instead of particles — the
 *    real approval pipeline underneath (points, XP, socket event) is identical.
 *
 * ## Why this screen never traps anyone
 *
 * Nothing route-guards on onboarding completeness. The only thing that ever sends a parent here is
 * `register.tsx`, once, right after account creation — see the comment there. A returning parent who
 * signs back in lands on the dashboard through the ordinary role-chooser redirect and never passes
 * through this screen again, whether they finished, skipped, or closed the app mid-wizard.
 */
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import type { ParentDashboardResponse } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { APPROVALS_KEY, decideApproval } from '@/lib/approvalsApi';
import { NetworkError } from '@/lib/api';
import { dashboardQuery, PARENT_DASHBOARD_KEY } from '@/lib/dashboardApi';
import { describeError } from '@/lib/errors';
import {
  completeOnboardingStep,
  dismissOnboarding,
  ONBOARDING_KEY,
  onboardingQuery,
  seedFirstApproval,
  type OnboardingState,
  type OnboardingStateResponse,
  type OnboardingStep,
} from '@/lib/onboardingApi';
import { fontSize, fontWeight, minTouchTarget, onGradient, radius, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

type Child = ParentDashboardResponse['children'][number];
type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface StepDef {
  id: OnboardingStep;
  title: string;
  description: string;
  icon: IoniconName;
  tone: AccentTone;
  href?: Href;
  cta: string;
}

const STEPS: readonly StepDef[] = [
  {
    id: 'child',
    title: 'Add your first child',
    description: 'Give them a name and a 4-digit PIN. They sign in with your family code.',
    icon: 'people',
    tone: 'xp',
    href: '/(parent)/child-form',
    cta: 'Add a child',
  },
  {
    id: 'tasks',
    title: 'Add a starter task',
    description: 'A ready-made chore beats a blank list. Pick one and change anything you like.',
    icon: 'checkbox',
    tone: 'primary',
    // Opens with the template picker already up, the same as the web: see the file header.
    href: { pathname: '/(parent)/task-form', params: { template: '1' } },
    cta: 'Add a task',
  },
  {
    id: 'reward',
    title: 'Add one reward',
    description: 'What will they work for? Pick an idea or write your own.',
    icon: 'gift',
    tone: 'gold',
    href: '/(parent)/reward-form',
    cta: 'Add a reward',
  },
  {
    id: 'handoff',
    title: 'Try it together',
    description: 'Approve your child’s first task and watch the points land for real.',
    icon: 'sparkles',
    tone: 'peach',
    cta: 'Show me',
  },
];

export default function Welcome() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();

  const onboarding = useQuery(onboardingQuery());
  // Reuses the dashboard's own cache entry — the tab bar and the dashboard screen already fetch this,
  // so a parent arriving here straight from registration is the only case that pays for the request.
  const dashboard = useQuery(dashboardQuery());

  const [busy, setBusy] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);

  const state = onboarding.data?.state ?? null;

  const setState = useCallback(
    (next: OnboardingState, isComplete: boolean) => {
      queryClient.setQueryData<OnboardingStateResponse>(ONBOARDING_KEY, (prev) =>
        prev ? { ...prev, state: next, isComplete } : prev
      );
    },
    [queryClient]
  );

  const { mutateAsync: runMarkDone } = useMutation({ mutationFn: completeOnboardingStep });

  /** Steps 1–3 only. Confirmed by the parent's own tap, same as the web — nothing here is auto-detected. */
  const markDone = useCallback(
    async (step: OnboardingStep) => {
      try {
        const res = await runMarkDone(step);
        setState(res.state, res.isComplete);
      } catch {
        // Non-fatal: the parent has done the thing; only the checkmark failed to save.
      }
    },
    [runMarkDone, setState]
  );

  /** Step 4: seed the pre-submitted task, approve it for real, celebrate. */
  const handleFirstApproval = useCallback(async () => {
    // Read fresh from `dashboard.data` rather than closing over a `children` array: that array would
    // be a new `[]` literal on every render `data.children` is absent, which is exactly the kind of
    // reference eslint's exhaustive-deps correctly refuses to trust in a dependency list below.
    const child: Child | undefined = dashboard.data?.children[0];
    if (!child) {
      toast.show('Add a child first (step 1).', 'error');
      return;
    }

    setBusy(true);
    try {
      const seeded = await seedFirstApproval(child.user.id);
      // The real approval pipeline: points, ledger, socket event, achievements — not a mock.
      const result = await decideApproval({ assignmentId: seeded.assignmentId, approved: true });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: APPROVALS_KEY }),
        queryClient.invalidateQueries({ queryKey: PARENT_DASHBOARD_KEY }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      ]);

      const stepResult = await runMarkDone('handoff');
      setState(stepResult.state, stepResult.isComplete);

      const points = result.pointsAwarded ?? 10;
      setCelebration(`${child.user.firstName} just earned ${points} points!`);
      toast.show(`${child.user.firstName} just earned their first points!`, 'success');
      setTimeout(() => setCelebration(null), 5000);
    } catch (caught) {
      toast.show(describeError(caught), 'error');
    } finally {
      setBusy(false);
    }
  }, [dashboard.data, queryClient, runMarkDone, setState, toast]);

  const handleDismiss = useCallback(async () => {
    await dismissOnboarding().catch(() => undefined);
    router.replace('/(parent)/dashboard');
  }, []);

  if (onboarding.isPending || dashboard.isPending) {
    return (
      <Screen>
        <GradientHeader tone="brand" icon="sparkles" eyebrow="Welcome" title="Loading your setup…" />
      </Screen>
    );
  }

  if (onboarding.isError || !state) {
    const offline = onboarding.error instanceof NetworkError;
    return (
      <Screen scroll>
        <GradientHeader tone="brand" icon="sparkles" eyebrow="Welcome" title="Set up your family" />
        <Callout kind="danger" title={offline ? 'No connection' : 'Could not load your setup progress'} live>
          {describeError(onboarding.error)}
        </Callout>
        <Button label="Try again" onPress={() => void onboarding.refetch()} />
      </Screen>
    );
  }

  const completedCount = state.completedSteps.length;
  const allDone = completedCount === STEPS.length;

  return (
    <Screen scroll>
      <GradientHeader
        tone={allDone ? 'success' : 'brand'}
        icon={allDone ? 'checkmark-circle' : 'sparkles'}
        eyebrow="Welcome"
        title={allDone ? 'You’re all set' : 'Let’s get you going'}
        subtitle={
          allDone
            ? 'Everything is ready. Your family can start earning.'
            : 'Four quick steps. Skip whenever you like, nothing here is required.'
        }
      >
        {/* White on the gradient, so the bar reads on either tone. */}
        <View style={[styles.progressTrack, { backgroundColor: 'rgba(255,255,255,0.3)' }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: onGradient, width: `${(completedCount / STEPS.length) * 100}%` },
            ]}
          />
        </View>
        <AppText style={[styles.progressLabel, { color: onGradient }]}>
          {completedCount} of {STEPS.length} done
        </AppText>
      </GradientHeader>

      {celebration && (
        <Callout kind="success" icon="sparkles" live>
          {celebration}
        </Callout>
      )}

      {STEPS.map((step, index) => {
        const isDone = state.completedSteps.includes(step.id);
        const isNext = !isDone && state.completedSteps.length === index;

        return (
          <Card key={step.id} style={isNext ? { borderColor: theme.primary, borderWidth: 2 } : undefined}>
            <View style={styles.stepRow}>
              <IconTile tone={isDone ? 'success' : step.tone} icon={isDone ? 'checkmark-circle' : step.icon} size={44} />
              <View style={styles.stepText}>
                <AppText
                  style={[
                    styles.stepTitle,
                    { color: isDone ? theme.mutedForeground : theme.cardForeground },
                    isDone && styles.stepTitleDone,
                  ]}
                >
                  {step.title}
                </AppText>
                {!isDone && (
                  <AppText style={[styles.stepDescription, { color: theme.mutedForeground }]}>
                    {step.description}
                  </AppText>
                )}
              </View>
              {isDone && <Chip compact variant="done" icon="checkmark" label="Done" />}
            </View>

            {!isDone && step.id !== 'handoff' && step.href && (
              <View style={styles.stepActions}>
                <View style={styles.stepActionsCol}>
                  <Button label={step.cta} onPress={() => router.push(step.href!)} />
                </View>
                <View style={styles.stepActionsCol}>
                  <Button
                    label="Already done"
                    variant="soft"
                    onPress={() => void markDone(step.id)}
                  />
                </View>
              </View>
            )}

            {!isDone && step.id === 'handoff' && (
              <View style={styles.stepActionsSingle}>
                <Button label={step.cta} onPress={() => void handleFirstApproval()} busy={busy} disabled={busy} />
              </View>
            )}
          </Card>
        );
      })}

      <View style={styles.actions}>
        {allDone ? (
          <Button label="Go to my dashboard" onPress={() => router.replace('/(parent)/dashboard')} />
        ) : (
          <Pressable
            onPress={() => void handleDismiss()}
            accessibilityRole="button"
            accessibilityLabel="Skip setup, I'll find my way around"
            style={styles.skipLink}
          >
            <AppText style={[styles.skipText, { color: theme.mutedForeground }]}>
              Skip setup, I&apos;ll find my way around
            </AppText>
          </Pressable>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressTrack: {
    height: 8,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: radius.full },
  progressLabel: {
    fontSize: fontSize.xs.fontSize,
    lineHeight: fontSize.xs.lineHeight,
    fontWeight: fontWeight.semibold,
    marginTop: spacing[2],
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  stepText: { flex: 1 },
  stepTitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.bold,
  },
  stepTitleDone: { textDecorationLine: 'line-through' },
  stepDescription: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[1],
  },
  stepActions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] },
  stepActionsCol: { flex: 1 },
  stepActionsSingle: { marginTop: spacing[3] },
  actions: { marginTop: spacing[2], marginBottom: spacing[6] },
  skipLink: { minHeight: minTouchTarget, justifyContent: 'center', alignItems: 'center' },
  skipText: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    textDecorationLine: 'underline',
  },
});
