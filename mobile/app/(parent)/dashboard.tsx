/**
 * Parent dashboard — the first screen with real data.
 *
 * Shape follows the web's parent dashboard: the approval queue first (it is the only thing here that
 * is *blocking* someone else), then the children, then the week's totals. Ordering by urgency rather
 * than by data-model tidiness is the point — a parent opening this app mid-morning wants to know
 * whether a child is waiting on them.
 *
 * Deliberately read-only for now. Approving from here needs the evidence viewer, which is its own
 * screen; this one links into it once that exists.
 */
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { ParentDashboardResponse } from '@taskbuddy/shared';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { dashboardQuery } from '@/lib/dashboardApi';
import { unreadCountQuery } from '@/lib/notificationsApi';
import { plural } from '@/lib/plural';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

type Child = ParentDashboardResponse['children'][number];

function Stat({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <AppText style={[styles.statValue, { color: theme.foreground }]}>{value}</AppText>
      <AppText style={[styles.statLabel, { color: theme.mutedForeground }]} numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

function ChildRow({ child, first }: { child: Child; first: boolean }) {
  const theme = useTheme();
  const { user, profile } = child;
  const waiting = child.pendingApproval > 0;

  return (
    <View style={[styles.childRow, { borderTopColor: theme.border }, first && styles.firstChildRow]}>
      <View style={styles.childHeader}>
        <AppText style={[styles.childName, { color: theme.cardForeground }]}>
          {profile.avatarEmoji ? `${profile.avatarEmoji} ` : ''}
          {user.firstName}
        </AppText>
        <AppText style={[styles.childMeta, { color: theme.mutedForeground }]}>
          Level {profile.level} · {profile.pointsBalance} pts
        </AppText>
      </View>

      <AppText style={[styles.childMeta, { color: theme.mutedForeground }]}>
        {child.completedToday} of {child.todaysTasks} done today
        {profile.currentStreakDays > 0 ? ` · ${profile.currentStreakDays}-day streak` : ''}
      </AppText>

      {waiting && (
        // Stated in words as well as colour — colour alone fails for anyone who cannot distinguish it,
        // and this is the row's most important fact.
        <AppText style={[styles.childWaiting, { color: theme.primary }]}>
          {child.pendingApproval} waiting for your approval
        </AppText>
      )}
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

      {/* First, because it is the only item here that is blocking somebody else. */}
      <Pressable
        onPress={() => router.push('/(parent)/approvals')}
        accessibilityRole="button"
        accessibilityLabel={
          pendingApprovals.length === 0
            ? 'Approvals, nothing waiting'
            : `Approvals, ${pendingApprovals.length} waiting`
        }
      >
        <Card
          style={
            pendingApprovals.length > 0 ? { borderColor: theme.primary, borderWidth: 2 } : undefined
          }
        >
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>Approvals</AppText>
          {pendingApprovals.length === 0 ? (
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              Nothing waiting. You&apos;re all caught up.
            </AppText>
          ) : (
            <>
              <AppText style={[styles.bigNumber, { color: theme.foreground }]}>
                {pendingApprovals.length}
              </AppText>
              <AppText style={[styles.body, { color: theme.cardForeground }]}>
                {pendingApprovals.length === 1 ? 'task is' : 'tasks are'} waiting for you to review.
              </AppText>
            </>
          )}
          <AppText style={[styles.body, { color: theme.primary }]}>Review →</AppText>
        </Card>
      </Pressable>

      <Pressable
        onPress={() => router.push('/(parent)/children')}
        accessibilityRole="button"
        accessibilityLabel={`Children, ${children.length}`}
      >
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>
            {children.length === 1 ? 'Child' : 'Children'}
          </AppText>
          {children.length === 0 ? (
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              No children added yet. You can add them on the web for now.
            </AppText>
          ) : (
            children.map((child, index) => (
              <ChildRow key={child.user.id} child={child} first={index === 0} />
            ))
          )}
          <AppText style={[styles.body, { color: theme.primary }]}>See details →</AppText>
        </Card>
      </Pressable>

      <Card>
        <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>This week</AppText>
        <View style={styles.statRow}>
          <Stat label="Tasks done" value={weeklyStats.tasksCompleted} />
          <Stat label="Tasks created" value={weeklyStats.tasksCreated} />
          <Stat label="Points earned" value={weeklyStats.pointsEarned} />
          <Stat label="Rewards" value={weeklyStats.rewardsRedeemed} />
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
        <Card style={unread > 0 ? { borderColor: theme.primary, borderWidth: 2 } : undefined}>
          <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>
            Notifications
          </AppText>
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
        <AppText style={[styles.cardTitle, { color: theme.mutedForeground }]}>More</AppText>
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
  bigNumber: {
    fontSize: fontSize['4xl'].fontSize,
    lineHeight: fontSize['4xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  statRow: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { width: '50%', paddingVertical: spacing[2], paddingRight: spacing[2] },
  statValue: {
    fontSize: fontSize.xl.fontSize,
    lineHeight: fontSize.xl.lineHeight,
    fontWeight: fontWeight.bold,
  },
  statLabel: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight },
  childRow: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  childHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing[1],
    gap: spacing[2],
  },
  childName: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  childMeta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  childWaiting: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
    marginTop: spacing[1],
  },
  actions: { marginTop: spacing[5] },
  moreRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] },
  // The first row sits directly under the card title, where a divider reads as a stray line.
  firstChildRow: { borderTopWidth: 0, paddingTop: 0, marginTop: 0 },
});
