/**
 * Child home.
 *
 * Ordered by what a child actually opens the app to see: who-they-are (hero), balance (wallet),
 * streak, goal, today's tasks, then the softer stuff.
 *
 * **Never renders evidence photos.** The child payload includes evidence rows but the route does not
 * presign their URLs, so they are storage keys rather than fetchable links — see `childDashboardApi.ts`.
 *
 * **States every status in words, not only colour.** A streak at risk, an overdue task and a completed
 * one are distinguishable without perceiving hue.
 *
 * ## Why the hero has no "X to level N" bar
 *
 * The redesign brief asks for an XP progress bar and an "X to level N" line. The API sends neither, and
 * this screen deliberately does not compute them — `childrenApi.ts` (the parent's children list) hit
 * this already: `backend/src/utils/gamification.ts` and `backend/src/services/achievements.ts` compute
 * level progress with two different formulas over two different XP fields, and `experiencePoints`
 * (meant to reset on level-up per the schema comment) never actually resets — every approval increments
 * it and `totalXpEarned` by the same amount, forever. A bar built from either would eventually disagree
 * with the level the server stored, worse than no bar on a screen a child reads literally. `profile.level`
 * alone is exactly what the server computed, so that is all the hero claims.
 */
// From the family's own module, never the `@expo/vector-icons` barrel — the barrel bundles all 20
// icon fonts on an app whose audience is families with cheap phones and metered data.
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { ChildDashboardResponse } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CardHeading } from '@/components/CardHeading';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { BAND_COPY, resolveAgeBand } from '@/lib/ageBand';
import { childDashboardQuery } from '@/lib/childDashboardApi';
import { dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { completionPercent, isDone } from '@/lib/taskStatus';
import { useAuth } from '@/stores/auth';
import { elevation, fontSize, fontWeight, onGradient, palette, radius, spacing, useTheme } from '@/theme';

type TodaysTask = ChildDashboardResponse['todaysTasks'][number];

/**
 * The masthead: who this is and what level they are. Fixed brand gradient (see `onGradient` in
 * `theme/index.ts`). Two nested views for the same reason `Card` uses them: the shadow needs the outer
 * view, and the circle needs an inner `overflow: 'hidden'` view or it squares off the rounded corners.
 */
function Hero({ level, name, seed, avatarEmoji, greeting }: {
  level: number;
  name: string;
  greeting: string;
  seed: string;
  avatarEmoji?: string | null;
}) {
  return (
    <View style={[styles.heroOuter, elevation.lift]}>
      {/* {0,0}->{1,1} approximates CSS's 135deg (top-left to bottom-right). */}
      <LinearGradient
        colors={[palette.xp[600], palette.xp[500], palette.primary[500]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.heroGradient}
      >
        {/* Decorative circle bleeding off the corner, so it is hidden from the accessibility tree. */}
        <View
          style={styles.heroCircle}
          pointerEvents="none"
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
        <View style={styles.heroRow}>
          <Avatar seed={seed} name={name} size={56} />
          <View style={styles.heroText}>
            <AppText variant="display" style={[styles.heroGreeting, { color: onGradient }]}>
              {avatarEmoji ? `${avatarEmoji} ` : ''}{greeting}
            </AppText>
            {/* The level, promoted to an object rather than a number in a chip row. */}
            <AppText variant="display" style={[styles.heroLevel, { color: onGradient }]}>
              Level {level}
            </AppText>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

/** The single most looked-at element on the child side. Fixed gold gradient; text is dark gold
 *  (`gold[800]`), never white — see the hard rule that gold's light steps cannot carry white text. */
function Wallet({ pointsBalance }: { pointsBalance: number }) {
  return (
    <View style={[styles.walletOuter, elevation.lift]}>
      <LinearGradient
        colors={[palette.gold[300], palette.gold[500]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.walletGradient}
        accessible
        accessibilityRole="text"
        accessibilityLabel={`${pointsBalance} points to spend`}
      >
        <AppText style={[styles.walletLabel, { color: palette.gold[800] }]}>Points to spend</AppText>
        <AppText variant="display" style={[styles.walletValue, { color: palette.gold[800] }]}>
          {pointsBalance}
        </AppText>
      </LinearGradient>
    </View>
  );
}

/** One line, per the redesign brief. The at-risk note folds into the same line as words rather than a
 *  second coloured block, matching the "one line" constraint and this screen's status-in-words rule. */
function StreakBanner({ current, atRisk }: { current: number; atRisk: boolean }) {
  if (current <= 0) return null;

  const label = atRisk
    ? `${current}-day streak, finish a task today to keep it!`
    : `${current}-day streak`;

  return (
    <View
      style={[styles.streakBanner, { backgroundColor: palette.peach[100] }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {/* peach[800], not the peach[500] the spec asked for. Measured on the peach[100] ground:
          500 gives 2.17:1 and 700 gives 4.30:1, both under the 4.5:1 AA minimum; 800 gives 5.83:1.
          The ramp's own comment in tokens.ts already warns that peach's light steps are decorative
          and not text colours, so the spec was contradicting the palette it was written from. The
          flame icon follows the text so the two do not drift apart. */}
      <Ionicons
        name="flame"
        size={18}
        color={palette.peach[800]}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
      <AppText style={[styles.streakText, { color: palette.peach[800] }]} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

/** The 32dp tick. Decorative here, not a control — this preview never took an action, and adding a tap
 *  target that did something new would be a behaviour change, not a restyle. Filled when done, else a
 *  ring, red when overdue; the words beside it carry the actual meaning. */
function TaskTick({ done, overdue }: { done: boolean; overdue: boolean }) {
  const theme = useTheme();

  if (done) {
    return (
      <View
        style={[styles.tick, styles.tickDone, { backgroundColor: palette.success[500] }]}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        <Ionicons name="checkmark" size={18} color={onGradient} />
      </View>
    );
  }

  return (
    <View
      style={[styles.tick, { borderColor: overdue ? theme.destructive : theme.border }]}
      importantForAccessibility="no"
      accessibilityElementsHidden
    />
  );
}

function TaskRow({ item, first }: { item: TodaysTask; first: boolean }) {
  const theme = useTheme();
  const { assignment, task } = item;
  const done = isDone(assignment.status);
  const overdue = !done && isOverdue(task.dueDate);
  const due = dueLabel(task.dueDate);

  return (
    // ⚠️ This row was a plain `View`. Tapping a task on the home tab did nothing at all, on either
    // tab, because the child app had no task screen to open — reported as "as a child I cannot open
    // to-do tasks or closed tasks".
    <Pressable
      onPress={() => router.push({ pathname: '/(child)/task-detail', params: { assignment: assignment.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Open "${task.title}"`}
      style={[styles.taskRow, { borderTopColor: theme.border }, first && styles.firstRow]}
    >
      <TaskTick done={done} overdue={overdue} />
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
    </Pressable>
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

  const name = user?.firstName ?? 'there';

  /**
   * Band resolved from the payload, falling back to the auth store while it loads so the greeting
   * does not change voice mid-render — switching from "Hi Ada!" to "Hey Ada" as data arrives reads
   * as a glitch.
   */
  const band = resolveAgeBand({
    dateOfBirth: data?.user?.dateOfBirth ?? user?.dateOfBirth ?? null,
    ageGroup: data?.profile?.ageGroup ?? null,
  });
  const copy = BAND_COPY[band];

  if (isPending) {
    return (
      <Screen>
        <AppText variant="display" style={[styles.greeting, { color: theme.foreground }]}>
          {copy.greeting(name)}
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
          {copy.greeting(name)}
        </AppText>
        <Card status="late">
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
      <Hero
        level={profile.level}
        name={name}
        seed={user?.id ?? 'child'}
        avatarEmoji={profile.avatarEmoji}
        greeting={copy.greeting(name)}
      />
      <Wallet pointsBalance={profile.pointsBalance} />
      <StreakBanner current={streak.current} atRisk={streak.atRisk} />

      {/* "I'm saving for…" — the goal-gradient card. Only when something is pinned. */}
      {goal && (
        <Card>
          <CardHeading icon="gift" label="You're saving for" tint={palette.gold[600]} />
          <AppText style={[styles.goalName, { color: theme.cardForeground }]}>{goal.name}</AppText>
          <ProgressBar
            percent={goal.percent}
            variant="points"
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
        <CardHeading icon="checkbox" label={copy.todayLabel} tint={palette.success[600]} />
        {todaysTasks.length === 0 ? (
          <AppText style={[styles.body, { color: theme.cardForeground }]}>{copy.emptyToday}</AppText>
        ) : (
          <>
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              {doneToday} of {todaysTasks.length} done
            </AppText>
            <ProgressBar
              percent={taskPercent}
              variant="completion"
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
              {/* Name only. `Achievement.iconUrl` is a real image URL, not an emoji — printing it in a
                  Text node would show the URL. The achievements screen renders it properly. */}
              <View style={styles.taskText}>
                <AppText style={[styles.taskName, { color: theme.cardForeground }]}>
                  {entry.achievement.name}
                </AppText>
              </View>
            </View>
          ))}
        </Card>
      )}

      {/* Sign-out lives on the Me tab, not here under the points balance. */}
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
  heroOuter: { borderRadius: radius.xl, marginBottom: spacing[4] },
  heroGradient: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    padding: spacing[5],
  },
  heroCircle: {
    position: 'absolute',
    top: -60,
    right: -50,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: onGradient,
    opacity: 0.15,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroText: { flex: 1 },
  heroGreeting: {
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  heroLevel: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginTop: spacing[1],
  },
  walletOuter: { borderRadius: radius.xl, marginBottom: spacing[4] },
  walletGradient: {
    borderRadius: radius.xl,
    padding: spacing[5],
    alignItems: 'center',
  },
  walletLabel: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  walletValue: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginTop: spacing[1],
  },
  streakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: radius.md,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    marginBottom: spacing[4],
  },
  streakText: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.semibold, flexShrink: 1 },
  goalName: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[2],
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderTopWidth: 1,
    paddingTop: spacing[3],
    marginTop: spacing[3],
  },
  firstRow: { borderTopWidth: 0, paddingTop: 0, marginTop: spacing[2] },
  tick: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickDone: { borderWidth: 0 },
  // Nudged down to sit on the title's first line rather than above it.
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
