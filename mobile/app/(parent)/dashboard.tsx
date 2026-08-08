/**
 * Parent dashboard: the first screen with real data.
 *
 * Shape follows the redesign brief: a headline stat row, then the approval queue (the only thing here
 * that is *blocking* someone else), then per-child progress, then the week's totals. Ordering by
 * urgency rather than by data-model tidiness is the point, a parent opening this app mid-morning wants
 * to know whether a child is waiting on them before anything else loads their attention.
 *
 * Deliberately read-only for now. Approving from here needs the evidence viewer, which is its own
 * screen; this one links into it once that exists.
 *
 * ## Where the colour goes
 *
 * Colour now encodes *state*, not mood: the "To approve" tile and the waiting-on-you cards read warm
 * (`warning`) because they need a decision, the empty/settled states read `success` green, and points
 * read `gold`. The state lives on the `Card` stripe and the `StatTile` tint, not on the numbers
 * themselves, so a mid-ramp accent never has to clear AA against body text.
 */
// The family's own module, not the `@expo/vector-icons` barrel — that barrel bundles all 20 icon
// fonts. Same rule as the tab bar in `_layout.tsx`.
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { ParentDashboardResponse } from '@taskbuddy/shared';

import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CardHeading } from '@/components/CardHeading';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { NetworkError } from '@/lib/api';
import { dashboardQuery } from '@/lib/dashboardApi';
import { unreadCountQuery } from '@/lib/notificationsApi';
import { plural } from '@/lib/plural';
import { completionPercent } from '@/lib/taskStatus';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, palette, spacing, useTheme } from '@/theme';

type Child = ParentDashboardResponse['children'][number];

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function Stat({ label, value, icon, tint }: { label: string; value: number; icon: IoniconName; tint: string }) {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <View style={styles.statHead}>
        <Ionicons
          name={icon}
          size={16}
          color={tint}
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
        <AppText style={[styles.statValue, { color: theme.foreground }]}>{value}</AppText>
      </View>
      <AppText style={[styles.statLabel, { color: theme.mutedForeground }]} numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

/**
 * One child's row in the per-child progress section.
 *
 * The redesign spec calls this "weekly progress", but `ParentDashboardResponse` only carries
 * `todaysTasks` / `completedToday` per child (see `shared/src/types/api.ts`), there is no per-child
 * weekly figure anywhere in this payload, only the family-wide `weeklyStats` below. Drawing the bar
 * from today's ratio and labelling it "weekly" would show a number that is not actually weekly, so this
 * renders what the data actually is (today's completion) rather than mislabel it. See the report for
 * this unit; a real weekly-per-child figure needs a backend change, which is out of scope here.
 */
function ChildProgressRow({ child, first }: { child: Child; first: boolean }) {
  const theme = useTheme();
  const { user, profile } = child;
  // Same helper the child-side screens use for their own completion bars, so a 0-of-0 day reads as 0%
  // here exactly like it does there, rather than two independently-written NaN guards drifting apart.
  const percent = completionPercent(child.completedToday, child.todaysTasks);

  return (
    <View style={[styles.childRow, { borderTopColor: theme.border }, first && styles.firstChildRow]}>
      <View style={styles.childHeader}>
        <Avatar seed={user.id} name={user.firstName} size={32} />
        <View style={styles.childHeaderText}>
          <AppText style={[styles.childName, { color: theme.cardForeground }]}>{user.firstName}</AppText>
          <AppText style={[styles.childMeta, { color: theme.mutedForeground }]}>
            Level {profile.level} · {profile.pointsBalance} pts
            {profile.currentStreakDays > 0 ? ` · ${profile.currentStreakDays}-day streak` : ''}
          </AppText>
        </View>
      </View>

      <ProgressBar
        percent={percent}
        variant="completion"
        label={`${user.firstName}, ${child.completedToday} of ${child.todaysTasks} tasks done today`}
        style={styles.childProgressBar}
      />
    </View>
  );
}

export default function ParentDashboard() {
  const theme = useTheme();
  const user = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);

  const { data, error, isPending, isError, refetch } = useQuery(dashboardQuery());
  // Same cache entry the NotificationWatcher polls — no extra request, and the badge can never
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

  if (isPending) {
    return (
      <Screen>
        <AppText variant="display" style={[styles.greeting, { color: theme.foreground }]}>{greeting}</AppText>
        <Card>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>Loading your family…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <AppText variant="display" style={[styles.greeting, { color: theme.foreground }]}>{greeting}</AppText>
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load your dashboard'}
          </AppText>
          <AppText style={[styles.body, { color: theme.cardForeground }]}>{describeError(error)}</AppText>
        </Card>
        <View style={styles.actions}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const { children, pendingApprovals, weeklyStats, family } = data;
  // Family totals for the headline row. Computed here rather than asked of the server: both are cheap
  // reductions over data this screen already has, and adding a second endpoint call for two sums would
  // be exactly the kind of new data-fetching this visual-only unit is not meant to introduce.
  const doneToday = children.reduce((sum, child) => sum + child.completedToday, 0);
  const pointsOut = children.reduce((sum, child) => sum + child.profile.pointsBalance, 0);

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
      <AppText variant="display" style={[styles.greeting, { color: theme.foreground }]}>{greeting}</AppText>
      <AppText style={[styles.subtitle, { color: theme.mutedForeground }]}>{family.familyName}</AppText>

      {/* Headline row: what needs the parent right now, above the fold. Three tiles, three stops for a
          screen reader (StatTile already combines each value and label into one accessibilityLabel), not
          four unlabelled numbers. */}
      <View style={styles.statTileRow}>
        <StatTile value={pendingApprovals.length} label="To approve" variant="warning" />
        <StatTile value={doneToday} label="Done today" variant="success" />
        <StatTile value={pointsOut} label="Points out" variant="gold" />
      </View>

      {/* First, because it is the only item here that is blocking somebody else. One navigation
          target for the whole queue, same as before this redesign: only the inside is now one
          pending-status card per item instead of a single summary card. */}
      <AppText style={[styles.sectionTitle, { color: theme.foreground }]}>Waiting on you</AppText>
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
          // Settled reads green, not the warm "pending" stripe: colour encodes state here, and an
          // empty queue is the "done" state, not a quiet version of "waiting".
          <Card status="done">
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              Nothing waiting. You&apos;re all caught up.
            </AppText>
          </Card>
        ) : (
          pendingApprovals.map((approval) => (
            <Card key={approval.id} status="pending">
              <View style={styles.rowHeader}>
                <AppText
                  style={[styles.approvalTitle, { color: theme.cardForeground }]}
                  numberOfLines={2}
                >
                  {approval.task.title}
                </AppText>
                <AppText style={[styles.points, { color: theme.foreground }]}>
                  {approval.task.pointsValue} pts
                </AppText>
              </View>
              <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                {approval.child.firstName} · waiting for your review
              </AppText>
            </Card>
          ))
        )}
      </Pressable>

      {/* Same single navigation target as before (children list); the content inside is now each
          child's own-day completion bar rather than a paragraph of stats. See ChildProgressRow for
          why this says "today" and not "weekly". */}
      <AppText style={[styles.sectionTitle, { color: theme.foreground }]}>Progress today</AppText>
      <Pressable
        onPress={() => router.push('/(parent)/children')}
        accessibilityRole="button"
        accessibilityLabel={`Children, ${children.length}`}
      >
        <Card>
          {children.length === 0 ? (
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              No children added yet. You can add them on the web for now.
            </AppText>
          ) : (
            children.map((child, index) => (
              <ChildProgressRow key={child.user.id} child={child} first={index === 0} />
            ))
          )}
          <AppText style={[styles.body, { color: theme.primary }]}>See details →</AppText>
        </Card>
      </Pressable>

      <Card>
        <CardHeading icon="stats-chart" label="This week" tint={theme.primary} />
        <View style={styles.statRow}>
          <Stat
            label="Tasks done"
            value={weeklyStats.tasksCompleted}
            icon="checkmark-circle"
            tint={palette.success[600]}
          />
          <Stat
            label="Tasks created"
            value={weeklyStats.tasksCreated}
            icon="add-circle"
            tint={theme.primary}
          />
          <Stat
            label="Points earned"
            value={weeklyStats.pointsEarned}
            icon="star"
            tint={palette.gold[600]}
          />
          <Stat
            label="Rewards"
            value={weeklyStats.rewardsRedeemed}
            icon="gift"
            tint={palette.xp[600]}
          />
        </View>
      </Card>

      {/*
        Standing in for a tab bar, which needs @react-navigation/bottom-tabs — not installed, and
        pulling in an undeclared native module is the Phase 0 failure class. Replaced by tabs when
        that dependency is added deliberately alongside the remaining screens.
      */}
      {/* The "View all tasks" / "Rewards" buttons that stood in for navigation are gone — the tab bar
          in (parent)/_layout.tsx covers it. The cards above stay tappable as shortcuts. */}
      <Pressable
        onPress={() => router.push('/(parent)/notifications')}
        accessibilityRole="button"
        accessibilityLabel={
          unread === 0 ? 'Notifications, nothing new' : `Notifications, ${unread} unread`
        }
      >
        {/* `info`, not `pending`: unread notifications are not an assignment awaiting the parent's
            decision the way an approval is, they share the app's own teal rather than the warm
            "needs you" colour. */}
        <Card status={unread > 0 ? 'info' : undefined}>
          <CardHeading
            icon={unread > 0 ? 'notifications' : 'notifications-outline'}
            label="Notifications"
            tint={unread > 0 ? theme.primary : undefined}
          />
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {unread > 0 ? plural(unread, 'unread message') : 'Nothing new.'}
          </AppText>
          <AppText style={[styles.body, { color: theme.primary }]}>Open →</AppText>
        </Card>
      </Pressable>

      {/*
        The four lower-frequency screens, grouped rather than given tabs of their own — five tabs is
        already the ceiling on a narrow phone.
      */}
      <Card>
        <CardHeading icon="apps" label="More" />
        <View style={styles.moreRow}>
          <Button
            label="This week"
            variant="secondary"
            onPress={() => router.push('/(parent)/calendar')}
          />
          <Button
            label="Insights"
            variant="secondary"
            onPress={() => router.push('/(parent)/insights')}
          />
        </View>
        <View style={styles.moreRow}>
          <Button
            label="Settings"
            variant="secondary"
            onPress={() => router.push('/(parent)/settings')}
          />
          <Button
            label="Devices"
            variant="secondary"
            onPress={() => router.push('/(parent)/devices')}
          />
        </View>
      </Card>

      <View style={styles.actions}>
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    marginTop: spacing[1],
    marginBottom: spacing[5],
  },
  cardTitle: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  sectionTitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[2],
    marginTop: spacing[1],
  },
  statTileRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[5] },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[3],
    marginBottom: spacing[1],
  },
  approvalTitle: {
    flex: 1,
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  points: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.bold,
  },
  statRow: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { width: '50%', paddingVertical: spacing[2], paddingRight: spacing[2] },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  statValue: {
    fontSize: fontSize.xl.fontSize,
    lineHeight: fontSize.xl.lineHeight,
    fontWeight: fontWeight.bold,
  },
  statLabel: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight },
  childRow: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  childHeader: {
    flexDirection: 'row',
    // Centre rather than baseline: the avatar is a fixed-size square and a View has no baseline for RN
    // to align against, it falls back to the bottom edge and the name sits high.
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[2],
  },
  childHeaderText: { flex: 1 },
  childName: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  childMeta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  childProgressBar: { marginTop: spacing[1] },
  actions: { marginTop: spacing[5] },
  moreRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] },
  // The first row sits directly under the card title, where a divider reads as a stray line.
  firstChildRow: { borderTopWidth: 0, paddingTop: 0, marginTop: 0 },
});
