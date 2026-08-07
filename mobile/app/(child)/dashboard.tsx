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
 *
 * ## The colour on this screen, and why some of it does not come from `useTheme()`
 *
 * The points card is filled with `theme.primary` and every word on it is `theme.primaryForeground`.
 * That pair is the one the token test measures in both appearances, so the hero card cannot drift
 * out of contrast without a test going red — which is the whole reason it is a semantic pair rather
 * than a teal picked by eye.
 *
 * The chips *on* that fill are the exception, and deliberately **not** theme-dependent: a chip sits on
 * teal, not on the screen, and teal is teal in both appearances. Each is a pale `palette` step
 * carrying a dark one from the same ramp — `xp` for the level, `peach` for the streak, `warning` for
 * the at-risk note — which is around 9:1 whatever the OS setting is. Swapping the ink for
 * `theme.foreground` would put slate-50 on peach in dark mode, at 2.00:1. Do not "simplify" these
 * into semantic roles.
 */
// From the family's own module, never the `@expo/vector-icons` barrel — the barrel bundles all 20
// icon fonts on an app whose audience is families with cheap phones and metered data.
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ChildDashboardResponse } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CardHeading } from '@/components/CardHeading';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { childDashboardQuery } from '@/lib/childDashboardApi';
import { dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { completionPercent, isDone } from '@/lib/taskStatus';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, palette, radius, spacing, useTheme } from '@/theme';

type TodaysTask = ChildDashboardResponse['todaysTasks'][number];

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * One fact from the points card — the level, or the streak — as a pill on the teal fill.
 *
 * `fill` and `ink` are always two steps of the same ramp, a pale one and a dark one, for the reason
 * in the header: this pill's background is teal in both appearances, so its text colour must not
 * follow the OS appearance or it inverts into a contrast failure exactly half the time.
 */
function StatChip(props: { icon: IoniconName; label: string; fill: string; ink: string }) {
  const { icon, label, fill, ink } = props;
  return (
    <View style={[styles.chip, { backgroundColor: fill }]}>
      <Ionicons
        name={icon}
        size={14}
        color={ink}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <AppText style={[styles.chipLabel, { color: ink }]}>{label}</AppText>
    </View>
  );
}

/**
 * A plain progress bar.
 *
 * Built from two Views rather than a dependency: an animated bar would mean reanimated, which is a
 * native module and the one that crashed Phase 0. Celebrations are a deliberate, separately-tested
 * step later in this phase — not something to smuggle in through a progress bar.
 */
function ProgressBar({
  percent,
  label,
  color,
}: {
  percent: number;
  label: string;
  /**
   * Fill colour. Defaults to the brand teal; pass a gamification accent where the bar is measuring
   * one particular thing — gold for points saved towards a reward, green for tasks finished.
   */
  color?: string;
}) {
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
      <View
        style={[styles.progressFill, { backgroundColor: color ?? theme.primary, width: `${width}%` }]}
      />
    </View>
  );
}

function TaskRow({ item, first }: { item: TodaysTask; first: boolean }) {
  const theme = useTheme();
  const { assignment, task } = item;
  const done = isDone(assignment.status);
  const overdue = !done && isOverdue(task.dueDate);
  const due = dueLabel(task.dueDate);

  /*
    The glyph repeats what the row already says in words — it is reinforcement, not the message, so
    losing it to a missing font or an unperceived hue costs nothing. `success[600]` rather than a
    lighter step because it has to stay visible on a white card *and* on the slate-800 one.
  */
  const mark: { icon: IoniconName; color: string } = done
    ? { icon: 'checkmark-circle', color: palette.success[600] }
    : overdue
      ? { icon: 'alert-circle', color: theme.destructive }
      : { icon: 'ellipse-outline', color: theme.mutedForeground };

  return (
    <View style={[styles.taskRow, { borderTopColor: theme.border }, first && styles.firstRow]}>
      <Ionicons
        name={mark.icon}
        size={20}
        color={mark.color}
        style={styles.taskMark}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <View style={styles.taskText}>
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
        <AppText
          style={[styles.taskMeta, { color: overdue ? theme.destructive : theme.mutedForeground }]}
        >
          {done
            ? assignment.status === 'approved'
              ? 'Approved'
              : 'Done — waiting for approval'
            : [due, `${task.pointsValue} pts`].filter(Boolean).join(' · ')}
        </AppText>
      </View>
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

      {/*
        The number the app exists to show, and the only card on the screen that is not white. Filled
        with `theme.primary` and lettered in `theme.primaryForeground` — the one pair the token test
        measures in both appearances, so this card cannot fall out of contrast silently.
      */}
      <Card style={{ backgroundColor: theme.primary, borderColor: theme.primary }}>
        <CardHeading icon="star" label="Your points" color={theme.primaryForeground} />
        <AppText style={[styles.bigNumber, { color: theme.primaryForeground }]}>
          {profile.pointsBalance}
        </AppText>
        <View style={styles.chipRow}>
          <StatChip
            icon="trending-up"
            label={`Level ${profile.level}`}
            fill={palette.xp[100]}
            ink={palette.xp[900]}
          />
          {streak.current > 0 && (
            <StatChip
              icon="flame"
              label={`${streak.current}-day streak`}
              fill={palette.peach[200]}
              ink={palette.peach[900]}
            />
          )}
        </View>
        {streak.atRisk && (
          // Amber rather than the destructive red it used to be: red on teal is the one combination
          // this fill cannot carry, and "at risk" is a warning anyway, not a failure. The words stay
          // the message — see the header note on stating status without relying on hue.
          <View style={[styles.riskNote, { backgroundColor: palette.warning[100] }]}>
            <Ionicons
              name="alert-circle"
              size={16}
              color={palette.warning[700]}
              importantForAccessibility="no"
              accessibilityElementsHidden
            />
            <AppText style={[styles.warning, { color: palette.warning[900] }]}>
              Your streak ends today unless you finish a task.
            </AppText>
          </View>
        )}
      </Card>

      {/* "I'm saving for…" — the goal-gradient card. Only when something is pinned. */}
      {goal && (
        <Card>
          <CardHeading icon="gift" label="You're saving for" tint={palette.gold[600]} />
          <AppText style={[styles.goalName, { color: theme.cardForeground }]}>{goal.name}</AppText>
          <ProgressBar
            percent={goal.percent}
            label={`${goal.name}, ${Math.round(goal.percent)} percent saved`}
            // Gold: this bar measures points saved, and points are gold everywhere else in the app.
            color={palette.gold[500]}
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
        <CardHeading icon="checkbox" label="Today" tint={palette.success[600]} />
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
              color={palette.success[500]}
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
          <CardHeading icon="flash" label="Today's challenge" tint={palette.xp[500]} />
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
          <CardHeading icon="gift-outline" label="Next reward" tint={palette.gold[600]} />
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
          <CardHeading icon="trophy" label="Recently unlocked" tint={palette.gold[600]} />
          {recentAchievements.map((entry, index) => (
            <View
              key={entry.achievement.id}
              style={[styles.taskRow, { borderTopColor: theme.border }, index === 0 && styles.firstRow]}
            >
              <Ionicons
                name="ribbon"
                size={20}
                color={palette.gold[600]}
                style={styles.taskMark}
                importantForAccessibility="no"
                accessibilityElementsHidden
              />
              {/*
                Name only. `Achievement.iconUrl` is a genuine image URL (the admin form validates it
                with `z.string().url()` and renders an <img>), not an emoji — putting it in a Text node
                would print the URL. The achievements screen renders it properly, with a fallback for
                the many achievements that have none.
              */}
              <View style={styles.taskText}>
                <AppText style={[styles.taskName, { color: theme.cardForeground }]}>
                  {entry.achievement.name}
                </AppText>
              </View>
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
    // Shares the amber note's row with the icon, so it takes the leftover width rather than pushing
    // a long sentence off the card.
    flexShrink: 1,
  },
  riskNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    borderRadius: radius.md,
    padding: spacing[3],
    marginTop: spacing[3],
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[3] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.full,
  },
  chipLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.semibold },
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
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    borderTopWidth: 1,
    paddingTop: spacing[3],
    marginTop: spacing[3],
  },
  firstRow: { borderTopWidth: 0, paddingTop: 0, marginTop: spacing[2] },
  // Nudged down to sit on the first line of the title rather than above it — the glyph's box is
  // taller than its ink, so aligning the boxes leaves it looking high.
  taskMark: { marginTop: 2 },
  taskText: { flex: 1 },
  taskName: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.medium,
  },
  taskNameDone: { textDecorationLine: 'line-through' },
  taskMeta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  actions: { marginTop: spacing[5] },
});
