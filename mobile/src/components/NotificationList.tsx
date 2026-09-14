/**
 * The notifications centre.
 *
 * One component behind two routes — `(parent)/notifications` and `(child)/me/notifications` — because
 * the payload is identical for both. The server scopes `/notifications` to the caller, so there is no
 * role branching here beyond where a tapped row leads.
 *
 * ## Tapping a row marks it read, then navigates
 *
 * In that order, and awaited. Navigating first would unmount this screen mid-request; React Query
 * would still complete it, but the invalidation would land on a screen nobody is looking at and the
 * badge would lag by one until the next poll.
 *
 * A row whose `actionUrl` has no mobile equivalent still marks itself read but does not navigate —
 * see `destinationFor`. Following a raw web path would either 404 or resolve to a same-named route in
 * the wrong shell, and landing somewhere arbitrary is worse than staying put.
 */
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { NetworkError } from '@/lib/api';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import {
  destinationFor,
  INVALIDATED_BY_NOTIFICATION_ACTION,
  markAllRead,
  markRead,
  notificationsQuery,
} from '@/lib/notificationsApi';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

function when(value: Date | string | null | undefined): string {
  const at = asDate(value);
  if (!at) return '';
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * A tile per kind of notification, so the list scans by colour: amber for something waiting on you,
 * green for good news, gold for points and rewards. Keyed on `notificationType`; anything not listed
 * (a type added later) falls back to the plain teal bell rather than guessing. The keys are the
 * `notificationType` values the backend actually writes (grep `notificationType:` in backend/src).
 */
const KIND: Record<string, { icon: IoniconName; tone: AccentTone }> = {
  task_submitted: { icon: 'hourglass', tone: 'warning' },
  task_assigned: { icon: 'checkbox', tone: 'primary' },
  task_approved: { icon: 'checkmark-circle', tone: 'success' },
  task_rejected: { icon: 'arrow-undo', tone: 'destructive' },
  task_expiring: { icon: 'time', tone: 'warning' },
  task_expired: { icon: 'time', tone: 'destructive' },
  task_archived: { icon: 'archive', tone: 'primary' },
  task_comment: { icon: 'chatbubble-ellipses', tone: 'primary' },
  task_limit_reached: { icon: 'alert-circle', tone: 'warning' },
  reward_redeemed: { icon: 'gift', tone: 'gold' },
  reward_fulfilled: { icon: 'gift', tone: 'success' },
  level_up: { icon: 'trending-up', tone: 'xp' },
  team_bonus: { icon: 'people', tone: 'xp' },
  child_avatar_pending: { icon: 'image', tone: 'peach' },
  child_avatar_reviewed: { icon: 'image', tone: 'success' },
};
const FALLBACK_KIND = { icon: 'notifications' as IoniconName, tone: 'primary' as AccentTone };

function Row({
  item,
  busy,
  onPress,
}: {
  item: Notification;
  busy: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      // Unread is a border colour AND the word "New" — a coloured edge alone conveys nothing to a
      // screen reader and nothing to anyone who cannot distinguish it.
      accessibilityLabel={`${item.isRead ? '' : 'Unread. '}${item.title}. ${item.message}`}
    >
      <Card status={item.isRead ? undefined : 'info'}>
        <View style={styles.row}>
          <IconTile
            tone={(KIND[item.notificationType] ?? FALLBACK_KIND).tone}
            icon={(KIND[item.notificationType] ?? FALLBACK_KIND).icon}
            size={40}
            muted={item.isRead}
          />
          <View style={styles.grow}>
            <View style={styles.headRow}>
              <AppText style={[styles.title, { color: theme.cardForeground }]}>{item.title}</AppText>
              {!item.isRead && (
                <View style={[styles.newPill, { backgroundColor: theme.primary }]}>
                  <AppText style={[styles.new, { color: theme.primaryForeground }]}>New</AppText>
                </View>
              )}
            </View>
            <AppText style={[styles.body, { color: theme.mutedForeground }]}>{item.message}</AppText>
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
              {when(item.createdAt)}
            </AppText>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

/**
 * `back` is required, not optional.
 *
 * Both routes that render this list are pushed on top of something, and both stacks run with
 * `headerShown: false`, so without an explicit control there is no way off this screen. Making the
 * prop mandatory is what stops a third caller from shipping the same dead end.
 */
export function NotificationList({
  role,
  back,
}: {
  role: 'parent' | 'child';
  back: { label: string; href: string };
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [actingId, setActingId] = useState<string | null>(null);

  const list = useInfiniteQuery(notificationsQuery());

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_NOTIFICATION_ACTION.map((key) =>
        queryClient.invalidateQueries({ queryKey: key })
      )
    );
  }, [queryClient]);

  const { mutateAsync: doMarkRead } = useMutation({ mutationFn: markRead });
  const { mutateAsync: doMarkAll } = useMutation({ mutationFn: markAllRead });

  const onPressRow = useCallback(
    async (item: Notification) => {
      setActingId(item.id);
      try {
        if (!item.isRead) {
          await doMarkRead(item.id);
          await invalidate();
        }
        const destination = destinationFor(item, role);
        if (destination) router.push(destination);
      } catch (caught) {
        toast.show(describeError(caught), 'error');
      } finally {
        setActingId(null);
      }
    },
    [doMarkRead, invalidate, role, toast]
  );

  const onMarkAll = useCallback(async () => {
    try {
      await doMarkAll();
      await invalidate();
      toast.show('All marked as read', 'success');
    } catch (caught) {
      toast.show(describeError(caught), 'error');
    }
  }, [doMarkAll, invalidate, toast]);

  const notifications = list.data?.pages.flatMap((p) => p.notifications) ?? [];
  const unread = list.data?.pages[0]?.unreadCount ?? 0;

  if (list.isPending) {
    return (
      <Screen>
        <BackLink label={back.label} href={back.href} />
        <Card>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (list.isError) {
    const offline = list.error instanceof NetworkError;
    return (
      <Screen scroll>
        <BackLink label={back.label} href={back.href} />
        <Callout kind="danger" title={offline ? 'No connection' : 'Could not load notifications'} live>
          {describeError(list.error)}
        </Callout>
        <Button label="Try again" onPress={() => void list.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <BackLink label={back.label} href={back.href} />

      <FlatList
        ListHeaderComponent={
          <GradientHeader
            tone="teal"
            icon="notifications"
            eyebrow="Notifications"
            title={unread > 0 ? `${unread} unread` : 'All caught up'}
            actions={unread > 0 ? [{ label: 'Mark all as read', icon: 'checkmark-done', onPress: () => void onMarkAll() }] : undefined}
          />
        }
        data={notifications}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Row item={item} busy={actingId === item.id} onPress={() => void onPressRow(item)} />
        )}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        ListEmptyComponent={<EmptyState emoji="🔔" title="Nothing here yet." />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  grow: { flex: 1 },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  newPill: { borderRadius: radius.full, paddingHorizontal: spacing[2], paddingVertical: 2 },
  new: { fontSize: fontSize.xs.fontSize, fontWeight: fontWeight.bold },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  meta: { fontSize: fontSize.xs.fontSize, marginTop: spacing[2] },
});
