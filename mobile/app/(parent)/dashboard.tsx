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
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { ParentDashboardResponse } from '@taskbuddy/shared';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { dashboardQuery } from '@/lib/dashboardApi';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

type Child = ParentDashboardResponse['children'][number];

function Stat({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: theme.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.mutedForeground }]} numberOfLines={2}>
        {label}
      </Text>
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
        <Text style={[styles.childName, { color: theme.cardForeground }]}>
          {profile.avatarEmoji ? `${profile.avatarEmoji} ` : ''}
          {user.firstName}
        </Text>
        <Text style={[styles.childMeta, { color: theme.mutedForeground }]}>
          Level {profile.level} · {profile.pointsBalance} pts
        </Text>
      </View>

      <Text style={[styles.childMeta, { color: theme.mutedForeground }]}>
        {child.completedToday} of {child.todaysTasks} done today
        {profile.currentStreakDays > 0 ? ` · ${profile.currentStreakDays}-day streak` : ''}
      </Text>

      {waiting && (
        // Stated in words as well as colour — colour alone fails for anyone who cannot distinguish it,
        // and this is the row's most important fact.
        <Text style={[styles.childWaiting, { color: theme.primary }]}>
          {child.pendingApproval} waiting for your approval
        </Text>
      )}
    </View>
  );
}

export default function ParentDashboard() {
  const theme = useTheme();
  const user = useAuth((state) => state.user);
  const signOut = useAuth((state) => state.signOut);

  const { data, error, isPending, isError, refetch } = useQuery(dashboardQuery());
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
        <Text style={[styles.greeting, { color: theme.foreground }]}>{greeting}</Text>
        <Card>
          <Text style={[styles.body, { color: theme.mutedForeground }]}>Loading your family…</Text>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <Text style={[styles.greeting, { color: theme.foreground }]}>{greeting}</Text>
        <Card>
          <Text style={[styles.cardTitle, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load your dashboard'}
          </Text>
          <Text style={[styles.body, { color: theme.cardForeground }]}>{describeError(error)}</Text>
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
      <Text style={[styles.greeting, { color: theme.foreground }]}>{greeting}</Text>
      <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>{family.familyName}</Text>

      {/* First, because it is the only item here that is blocking somebody else. */}
      <Card
        style={
          pendingApprovals.length > 0 ? { borderColor: theme.primary, borderWidth: 2 } : undefined
        }
      >
        <Text style={[styles.cardTitle, { color: theme.mutedForeground }]}>Approvals</Text>
        {pendingApprovals.length === 0 ? (
          <Text style={[styles.body, { color: theme.cardForeground }]}>
            Nothing waiting. You&apos;re all caught up.
          </Text>
        ) : (
          <>
            <Text style={[styles.bigNumber, { color: theme.foreground }]}>
              {pendingApprovals.length}
            </Text>
            <Text style={[styles.body, { color: theme.cardForeground }]}>
              {pendingApprovals.length === 1 ? 'task is' : 'tasks are'} waiting for you to review.
            </Text>
          </>
        )}
      </Card>

      <Card>
        <Text style={[styles.cardTitle, { color: theme.mutedForeground }]}>
          {children.length === 1 ? 'Child' : 'Children'}
        </Text>
        {children.length === 0 ? (
          <Text style={[styles.body, { color: theme.cardForeground }]}>
            No children added yet. You can add them on the web for now.
          </Text>
        ) : (
          children.map((child, index) => (
            <ChildRow key={child.user.id} child={child} first={index === 0} />
          ))
        )}
      </Card>

      <Card>
        <Text style={[styles.cardTitle, { color: theme.mutedForeground }]}>This week</Text>
        <View style={styles.statRow}>
          <Stat label="Tasks done" value={weeklyStats.tasksCompleted} />
          <Stat label="Tasks created" value={weeklyStats.tasksCreated} />
          <Stat label="Points earned" value={weeklyStats.pointsEarned} />
          <Stat label="Rewards" value={weeklyStats.rewardsRedeemed} />
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
  // The first row sits directly under the card title, where a divider reads as a stray line.
  firstChildRow: { borderTopWidth: 0, paddingTop: 0, marginTop: 0 },
});
