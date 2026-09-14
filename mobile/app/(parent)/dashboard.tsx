/**
 * Parent dashboard: the first screen with real data.
 *
 * Shape: a masthead, the headline stat row, the approval queue (the only thing here that is *blocking*
 * someone else), per-child progress, the week's totals, then the less frequent screens. Ordering by
 * urgency rather than by data-model tidiness is the point: a parent opening this app mid-morning wants
 * to know whether a child is waiting on them before anything else takes their attention.
 *
 * ## Where the colour goes
 *
 * Colour encodes *state*, not mood: the "To approve" tile and the waiting-on-you cards read amber because
 * they need a decision, settled states read green, and points read gold. The masthead is teal, the colour
 * the parent side carries everywhere (see `theme/accents.ts`).
 *
 * ## Reports
 *
 * `(parent)/reports` existed with no way to reach it: nothing in the app linked to it. It now has a tile
 * under "More", alongside the other lower-frequency screens.
 */
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { ParentDashboardResponse } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { GradientHeader } from '@/components/GradientHeader';
import { NavTile } from '@/components/NavTile';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { SetupChecklistCard } from '@/components/SetupChecklistCard';
import { StatTile } from '@/components/StatTile';
import { NetworkError } from '@/lib/api';
import { dashboardQuery } from '@/lib/dashboardApi';
import { unreadCountQuery } from '@/lib/notificationsApi';
import { plural } from '@/lib/plural';
import { completionPercent } from '@/lib/taskStatus';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

type Child = ParentDashboardResponse['children'][number];

/**
 * One child's row in the per-child progress section.
 *
 * `ParentDashboardResponse` only carries `todaysTasks` / `completedToday` per child (see
 * `shared/src/types/api.ts`); there is no per-child weekly figure in this payload, only the family-wide
 * `weeklyStats` below. So the bar is today's completion and is labelled as today, not "weekly".
 */
function ChildProgressRow({ child, first }: { child: Child; first: boolean }) {
  const theme = useTheme();
  const { user, profile } = child;
  // Same helper the child-side screens use for their own completion bars, so a 0-of-0 day reads as 0%
  // here exactly like it does there.
  const percent = completionPercent(child.completedToday, child.todaysTasks);

  return (
    <View style={[styles.childRow, { borderTopColor: theme.border }, first && styles.firstChildRow]}>
      <View style={styles.childHeader}>
        <Avatar seed={user.id} name={user.firstName} size={40} />
        <View style={styles.grow}>
          <AppText style={[styles.childName, { color: theme.cardForeground }]}>{user.firstName}</AppText>
          <View style={styles.chips}>
            <Chip compact variant="xp" label={`Level ${profile.level}`} />
            <Chip compact variant="gold" icon="star" label={`${profile.pointsBalance} pts`} />
            {profile.currentStreakDays > 0 && (
              <Chip compact variant="peach" icon="flame" label={`${profile.currentStreakDays}-day streak`} />
            )}
          </View>
        </View>
      </View>

      <View style={styles.progressRow}>
        <View style={styles.grow}>
          <ProgressBar
            percent={percent}
            variant="completion"
            label={`${user.firstName}, ${child.completedToday} of ${child.todaysTasks} tasks done today`}
          />
        </View>
        <AppText style={[styles.progressLabel, { color: theme.mutedForeground }]}>
          {child.completedToday} of {child.todaysTasks}
        </AppText>
      </View>
    </View>
  );
}

export default function ParentDashboard() {
  const theme = useTheme();
  const user = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);

  const { data, error, isPending, isError, refetch } = useQuery(dashboardQuery());
  // Same cache entry the NotificationWatcher polls: no extra request, and the badge can never
  // disagree with the toast that announced the arrival.
  const unread = useQuery(unreadCountQuery()).data?.count ?? 0;
  const [refreshing, setRefreshing] = useState(false);

  /**
   * Pull-to-refresh drives its own spinner rather than reusing `isFetching`. React Query flips that
   * flag for background refetches too, so the pull control would spin at moments the user did not pull
   * and, worse, fail to stop when they did.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const greeting = `Hello, ${user?.firstName ?? 'there'}`;
  const avatar = <Avatar seed={user?.id ?? 'parent'} name={user?.firstName ?? 'P'} size={52} />;

  if (isPending) {
    return (
      <Screen>
        <GradientHeader tone="teal" title={greeting} subtitle="Loading your family…" badge={avatar} />
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <GradientHeader tone="teal" title={greeting} badge={avatar} />
        <Callout kind="danger" title={offline ? 'No connection' : 'Could not load your dashboard'} live>
          {describeError(error)}
        </Callout>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  const { children, pendingApprovals, weeklyStats, family } = data;
  // Family totals for the headline row: cheap reductions over data this screen already has.
  const doneToday = children.reduce((sum, child) => sum + child.completedToday, 0);
  // Points sitting unspent across every child's balance right now, not points awarded this week (that
  // is `weeklyStats.pointsEarned` below). "Held", not "out": "out" reads as "given out" to a parent.
  const pointsHeld = children.reduce((sum, child) => sum + child.profile.pointsBalance, 0);

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
      <GradientHeader
        tone="teal"
        eyebrow={family.familyName}
        title={greeting}
        subtitle={
          pendingApprovals.length === 0
            ? 'Nothing is waiting for you'
            : `${plural(pendingApprovals.length, 'task')} waiting for you`
        }
        badge={avatar}
      />

      {/* Above the stat row on purpose: during setup those three tiles are all zeros, so the nudge is
          the only thing on this screen with anything to say. Renders nothing once setup is done. */}
      <SetupChecklistCard />

      {/* StatTile always announces "{value} {label}", so each label is chosen to read on its own. */}
      <View style={styles.statTileRow}>
        <StatTile value={pendingApprovals.length} label="To approve" variant="warning" />
        <StatTile value={doneToday} label="Done today" variant="success" />
        <StatTile value={pointsHeld} label="Points held" variant="gold" />
      </View>

      <SectionTitle title="Waiting on you" icon="hourglass" tone="warning" />
      {/* One navigation target for the whole queue: approving needs the evidence viewer, which lives
          on the Approvals tab. */}
      <Pressable
        onPress={() => router.push('/(parent)/approvals')}
        accessibilityRole="button"
        accessibilityLabel={
          pendingApprovals.length === 0
            ? 'Approvals, nothing waiting'
            : `Approvals, ${pendingApprovals.length} waiting`
        }
      >
        {pendingApprovals.length === 0 ? (
          // Settled reads green: an empty queue is the "done" state, not a quiet version of "waiting".
          <Callout kind="success" icon="checkmark-done">
            Nothing waiting. You&apos;re all caught up.
          </Callout>
        ) : (
          pendingApprovals.map((approval) => (
            <Card key={approval.id} status="pending">
              <View style={styles.approvalRow}>
                <Avatar seed={approval.child.id} name={approval.child.firstName} size={40} />
                <View style={styles.grow}>
                  <AppText style={[styles.approvalTitle, { color: theme.cardForeground }]} numberOfLines={2}>
                    {approval.task.title}
                  </AppText>
                  <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                    {approval.child.firstName} · waiting for your review
                  </AppText>
                </View>
                <Chip compact variant="gold" icon="star" label={`${approval.task.pointsValue} pts`} />
              </View>
            </Card>
          ))
        )}
      </Pressable>

      <SectionTitle title="Progress today" icon="checkbox" tone="success" />
      <Pressable
        onPress={() => router.push('/(parent)/children')}
        accessibilityRole="button"
        accessibilityLabel={`Children, ${children.length}`}
      >
        <Card>
          {children.length === 0 ? (
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              No children added yet. Add one from the Children tab.
            </AppText>
          ) : (
            children.map((child, index) => (
              <ChildProgressRow key={child.user.id} child={child} first={index === 0} />
            ))
          )}
        </Card>
      </Pressable>

      <SectionTitle title="This week" icon="stats-chart" tone="primary" />
      <View style={styles.statTileRow}>
        <StatTile value={weeklyStats.tasksCompleted} label="Tasks done" variant="success" />
        <StatTile value={weeklyStats.tasksCreated} label="Tasks created" variant="info" />
      </View>
      <View style={styles.statTileRow}>
        <StatTile value={weeklyStats.pointsEarned} label="Points earned" variant="gold" />
        <StatTile value={weeklyStats.rewardsRedeemed} label="Rewards" variant="xp" />
      </View>

      {/* The lower-frequency screens, grouped rather than given tabs of their own: five tabs is already
          the ceiling on a narrow phone. */}
      <SectionTitle title="More" icon="apps" tone="primary" />
      <NavTile
        title="Notifications"
        icon={unread > 0 ? 'notifications' : 'notifications-outline'}
        tone="primary"
        subtitle={unread > 0 ? plural(unread, 'unread message') : 'Nothing new.'}
        badge={unread > 0 ? `${unread} new` : undefined}
        onPress={() => router.push('/(parent)/notifications')}
      />
      <NavTile
        title="This week"
        icon="calendar"
        tone="success"
        subtitle="Each child's tasks, day by day"
        onPress={() => router.push('/(parent)/calendar')}
      />
      <NavTile
        title="Insights"
        icon="stats-chart"
        tone="xp"
        subtitle="Best days, busiest times, points"
        onPress={() => router.push('/(parent)/insights')}
      />
      <NavTile
        title="Reports"
        icon="document-text"
        tone="warning"
        subtitle="Download CSV or PDF"
        onPress={() => router.push('/(parent)/reports')}
      />
      <NavTile
        title="Settings"
        icon="settings"
        tone="primary"
        subtitle="Family rules, co-parents, support"
        onPress={() => router.push('/(parent)/settings')}
      />
      <NavTile
        title="Signed-in devices"
        icon="phone-portrait"
        tone="peach"
        subtitle="See and sign out devices"
        onPress={() => router.push('/(parent)/devices')}
      />

      <View style={styles.actions}>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  grow: { flex: 1 },
  statTileRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[2] },
  approvalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  approvalTitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  childRow: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  // The first row sits at the top of the card, where a divider reads as a stray line.
  firstChildRow: { borderTopWidth: 0, paddingTop: 0, marginTop: 0 },
  childHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  childName: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[1] },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginTop: spacing[3] },
  progressLabel: { fontSize: fontSize.sm.fontSize, fontVariant: ['tabular-nums'] },
  actions: { marginTop: spacing[3], marginBottom: spacing[2] },
});
