/**
 * Child home.
 *
 * Ordered by what a child actually opens the app to see, which is not the same order the parent
 * dashboard uses. A parent wants to know who is blocked on them; a child wants to know how many points
 * they have and how close they are to the thing they are saving for. So: balance, then goal, then
 * today's tasks, then the softer stuff.
 *
 * ## Two things this screen deliberately does not do
 *
 * **It never renders evidence photos.** The child payload includes evidence rows but the route does not
 * presign their URLs, so they are storage keys rather than fetchable links — see the note in
 * `childDashboardApi.ts`. Rendering them would produce broken images, not a privacy leak, but it is
 * worth knowing which of the two it is.
 *
 * **It states every status in words, not only colour.** A streak at risk, an overdue task and a
 * completed one are distinguishable without perceiving hue. Families reviewers check this, and it is
 * the right thing regardless.
 */
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ChildDashboardResponse } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { childDashboardQuery } from '@/lib/childDashboardApi';
import { dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { completionPercent, isDone } from '@/lib/taskStatus';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

type TodaysTask = ChildDashboardResponse['todaysTasks'][number];

/**
 * A plain progress bar.
 *
 * Built from two Views rather than a dependency: an animated bar would mean reanimated, which is a
 * native module and the one that crashed Phase 0. Celebrations are a deliberate, separately-tested
 * step later in this phase — not something to smuggle in through a progress bar.
 */
function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const theme = useTheme();
  // Clamped rather than trusted: `goal.percent` is already clamped server-side, but the task counter
  // below computes its own and a division by zero would render a NaN-width bar.
  const width = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;

  return (
    <View
      style={[styles.progressTrack, { backgroundColor: theme.muted }]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(width) }}
    >
      <View style={[styles.progressFill, { backgroundColor: theme.primary, width: `${width}%` }]} />
    </View>
  );
}

function TaskRow({ item, first }: { item: TodaysTask; first: boolean }) {
  const theme = useTheme();
  const { assignment, task } = item;
  const done = isDone(assignment.status);
  const overdue = !done && isOverdue(task.dueDate);
  const due = dueLabel(task.dueDate);

  return (
    <View style={[styles.taskRow, { borderTopColor: theme.border }, first && styles.firstRow]}>
      <AppText
        style={[
          styles.taskName,
          { color: done ? theme.mutedForeground : theme.cardForeground },
          done && styles.taskNameDone,
        ]}
        numberOfLines={2}
      >
        {task.title}
      </AppText>
      <AppText style={[styles.taskMeta, { color: overdue ? theme.destructive : theme.mutedForeground }]}>
        {done
          ? assignment.status === 'approved'
            ? 'Approved'
            : 'Done — waiting for approval'
          : [due, `${task.pointsValue} pts`].filter(Boolean).join(' · ')}
      </AppText>
    </View>
  );
}

export default function ChildDashboard() {
  const theme = useTheme();
  const user = useAuth((state) => state.user);

  const { data, error, isPending, isError, refetch } = useQuery(childDashboardQuery());
  const [refreshing, setRefreshing] = useState(false);

  // Same reasoning as the parent dashboard: `isFetching` also flips for background refetches, so the
  // pull control would spin unprompted and fail to stop when actually pulled.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const greeting = `Hi ${user?.firstName ?? 'there'}!`;

  if (isPending) {
    return (
      <Screen>
        <AppText variant="display" style={[styles.greeting, { color: theme.foreground }]}>
          {greeting}
        </AppText>
        <Card>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <AppText variant="display" style={[styles.greeting, { color: theme.foreground }]}>
          {greeting}
        </AppText>
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load your points'}
          </AppText>
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.actions}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const { profile, todaysTasks, streak, dailyChallenge, nextReward, goal, recentAchievements } = data;

  const doneToday = todaysTasks.filter((t) => isDone(t.assignment.status)).length;
  const taskPercent = completionPercent(doneToday, todaysTasks.length);

  return (
    <Screen
      scroll
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.primary}
          colors={[theme.primary]}
        />
      }
    >
      <AppText variant="display" style={[styles.greeting, { color: theme.foreground }]}>
        {profile.avatarEmoji ? `${profile.avatarEmoji} ` : ''}
        {greeting}
      </AppText>

      {/* The number the app exists to show. */}
      <Card>
        <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>Your points</AppText>
        <AppText style={[styles.bigNumber, { color: theme.foreground }]}>
          {profile.pointsBalance}
        </AppText>
        <AppText style={[styles.body, { color: theme.cardForeground }]}>
          Level {profile.level}
          {streak.current > 0 ? ` · ${streak.current}-day streak` : ''}
        </AppText>
        {streak.atRisk && (
          <AppText style={[styles.warning, { color: theme.destructive }]}>
            Your streak ends today unless you finish a task.
          </AppText>
        )}
      </Card>

      {/* "I'm saving for…" — the goal-gradient card. Only when something is pinned. */}
      {goal && (
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>
            You&apos;re saving for
          </AppText>
          <AppText style={[styles.goalName, { color: theme.cardForeground }]}>{goal.name}</AppText>
          <ProgressBar
            percent={goal.percent}
            label={`${goal.name}, ${Math.round(goal.percent)} percent saved`}
          />
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>
            {goal.pointsNeeded === 0
              ? 'You can afford it now!'
              : `${goal.pointsNeeded} points to go — about ${goal.tasksToGo} ${
                  goal.tasksToGo === 1 ? 'task' : 'tasks'
                }`}
          </AppText>
        </Card>
      )}

      <Card>
        <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>Today</AppText>
        {todaysTasks.length === 0 ? (
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            Nothing due today. Enjoy it.
          </AppText>
        ) : (
          <>
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              {doneToday} of {todaysTasks.length} done
            </AppText>
            <ProgressBar
              percent={taskPercent}
              label={`Today's tasks, ${doneToday} of ${todaysTasks.length} done`}
            />
            {todaysTasks.map((item, index) => (
              <TaskRow key={item.assignment.id} item={item} first={index === 0} />
            ))}
          </>
        )}
      </Card>

      {/* Hidden once banked — re-showing a finished challenge reads as the app not noticing. */}
      {dailyChallenge && !dailyChallenge.completed && (
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>
            Today&apos;s challenge
          </AppText>
          <AppText style={[styles.goalName, { color: theme.cardForeground }]}>
            {dailyChallenge.title}
          </AppText>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>
            {dailyChallenge.progress} of {dailyChallenge.target} · +{dailyChallenge.bonusPoints} bonus
            points
          </AppText>
        </Card>
      )}

      {/* Only when nothing is pinned — with a goal set, this card would suggest a competing target. */}
      {!goal && nextReward && (
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>Next reward</AppText>
          <AppText style={[styles.goalName, { color: theme.cardForeground }]}>
            {nextReward.reward.name}
          </AppText>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>
            {nextReward.pointsNeeded} more points
          </AppText>
        </Card>
      )}

      {recentAchievements.length > 0 && (
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>
            Recently unlocked
          </AppText>
          {recentAchievements.map((entry, index) => (
            <View
              key={entry.achievement.id}
              style={[styles.taskRow, { borderTopColor: theme.border }, index === 0 && styles.firstRow]}
            >
              {/*
                Name only. `Achievement.iconUrl` is a genuine image URL (the admin form validates it
                with `z.string().url()` and renders an <img>), not an emoji — putting it in a Text node
                would print the URL. The achievements screen renders it properly, with a fallback for
                the many achievements that have none.
              */}
              <AppText style={[styles.taskName, { color: theme.cardForeground }]}>
                {entry.achievement.name}
              </AppText>
            </View>
          ))}
        </Card>
      )}

      {/* Sign-out lives on the Me tab. The home tab is for what a child came here to do, and a control
          that ends the session sitting under their points balance is an odd place for it. */}
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[4],
  },
  cardTitle: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  warning: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
    marginTop: spacing[2],
  },
  bigNumber: {
    fontSize: fontSize['4xl'].fontSize,
    lineHeight: fontSize['4xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  goalName: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[2],
  },
  progressTrack: {
    height: spacing[2],
    borderRadius: radius.full,
    overflow: 'hidden',
    marginVertical: spacing[2],
  },
  progressFill: { height: '100%', borderRadius: radius.full },
  taskRow: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  firstRow: { borderTopWidth: 0, paddingTop: 0, marginTop: spacing[2] },
  taskName: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.medium,
  },
  taskNameDone: { textDecorationLine: 'line-through' },
  taskMeta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  actions: { marginTop: spacing[5] },
});
