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
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
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
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function when(value: Date | string | null | undefined): string {
  const at = asDate(value);
  if (!at) return '';
  const minutes = Math.round((Date.now() - at.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

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
      <Card style={item.isRead ? undefined : { borderLeftColor: theme.primary, borderLeftWidth: 4 }}>
        <View style={styles.headRow}>
          <AppText style={[styles.title, { color: theme.cardForeground }]}>{item.title}</AppText>
          {!item.isRead && <AppText style={[styles.new, { color: theme.primary }]}>New</AppText>}
        </View>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>{item.message}</AppText>
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
          {when(item.createdAt)}
        </AppText>
      </Card>
    </Pressable>
  );
}

export function NotificationList({ role }: { role: 'parent' | 'child' }) {
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
        <Card>
          <AppText style={[styles.title, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load notifications'}
          </AppText>
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {describeError(list.error)}
          </AppText>
        </Card>
        <View style={styles.action}>
          <Button label="Try again" onPress={() => void list.refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.headRow}>
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          Notifications
        </AppText>
      </View>

      {unread > 0 && (
        <View style={styles.action}>
          <Button label="Mark all as read" variant="secondary" onPress={() => void onMarkAll()} />
        </View>
      )}

      <FlatList
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
        ListEmptyComponent={
          <Card>
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              Nothing here yet.
            </AppText>
          </Card>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  headRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing[2],
  },
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  new: { fontSize: fontSize.xs.fontSize, fontWeight: fontWeight.bold },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  meta: { fontSize: fontSize.xs.fontSize, marginTop: spacing[2] },
  action: { marginVertical: spacing[3] },
});
