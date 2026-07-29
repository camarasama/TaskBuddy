/**
 * Parent task list.
 *
 * Uses a FlatList as its own scroller rather than sitting inside `Screen`'s ScrollView — nesting a
 * virtualised list in a ScrollView defeats the virtualisation and RN warns about it. `Screen` is still
 * the container, with `scroll` off.
 *
 * Paged, because a family a year into using this has hundreds of tasks and rendering them all on a
 * phone is slow in a way that is hard to walk back once screens depend on the shape.
 */
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { parentTasksQuery, type ParentTask, type TaskFilters } from '@/lib/tasksApi';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

type StatusFilter = TaskFilters['status'] | 'all';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'archived', label: 'Archived' },
];

function FilterChips({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (next: StatusFilter) => void;
}) {
  const theme = useTheme();

  return (
    <View style={styles.chipRow}>
      {FILTERS.map((filter) => {
        const selected = filter.key === value;
        return (
          <Pressable
            key={filter.key}
            onPress={() => onChange(filter.key)}
            accessibilityRole="button"
            // Announces which chip is active; a background colour alone tells a screen reader nothing.
            accessibilityState={{ selected }}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? theme.primary : theme.card,
                borderColor: selected ? theme.primary : theme.border,
              },
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                { color: selected ? theme.primaryForeground : theme.cardForeground },
              ]}
            >
              {filter.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One line summarising who has this task and where they are with it.
 *
 * Counts rather than a list of names: a task assigned to three children with different statuses turns
 * into an unreadable row otherwise, and the number waiting on the parent is the part that matters.
 */
function assignmentSummary(task: ParentTask): string {
  const total = task.assignments.length;
  if (total === 0) return 'Unassigned';

  const awaiting = task.assignments.filter((a) => a.status === 'completed').length;
  const approved = task.assignments.filter((a) => a.status === 'approved').length;

  const parts = [`${total} assigned`];
  if (awaiting > 0) parts.push(`${awaiting} awaiting approval`);
  if (approved > 0) parts.push(`${approved} approved`);
  return parts.join(' · ');
}

function TaskRow({ task }: { task: ParentTask }) {
  const theme = useTheme();
  const due = dueLabel(task.dueDate);
  const overdue = isOverdue(task.dueDate) && task.status === 'active';

  return (
    <Card>
      <View style={styles.rowHeader}>
        <Text style={[styles.taskTitle, { color: theme.cardForeground }]} numberOfLines={2}>
          {task.title}
        </Text>
        <Text style={[styles.points, { color: theme.foreground }]}>{task.pointsValue} pts</Text>
      </View>

      <Text style={[styles.meta, { color: theme.mutedForeground }]}>
        {assignmentSummary(task)}
      </Text>

      <View style={styles.badgeRow}>
        {due !== null && (
          // Overdue is said in words ("N days overdue") as well as coloured, so the state does not
          // depend on distinguishing red from grey.
          <Text
            style={[styles.badge, { color: overdue ? theme.destructive : theme.mutedForeground }]}
          >
            {due}
          </Text>
        )}
        {task.difficulty && (
          <Text style={[styles.badge, { color: theme.mutedForeground }]}>{task.difficulty}</Text>
        )}
        {task.status !== 'active' && (
          <Text style={[styles.badge, { color: theme.mutedForeground }]}>{task.status}</Text>
        )}
        {task.requiresPhotoEvidence && (
          <Text style={[styles.badge, { color: theme.mutedForeground }]}>photo required</Text>
        )}
      </View>
    </Card>
  );
}

export default function ParentTasks() {
  const theme = useTheme();
  const [status, setStatus] = useState<StatusFilter>('all');

  // `all` means "send no status param" — the backend has no 'all' value and rejects one.
  const filters = useMemo<TaskFilters>(() => (status === 'all' ? {} : { status }), [status]);

  const {
    data,
    error,
    isPending,
    isError,
    refetch,
    isRefetching,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(parentTasksQuery(filters));

  const tasks = useMemo(() => data?.pages.flatMap((page) => page.tasks) ?? [], [data]);
  const total = data?.pages[0]?.pagination.total ?? 0;

  const onEndReached = useCallback(() => {
    // Guarded: FlatList fires this repeatedly while near the end, and without the check every fire
    // would queue another page request.
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const header = (
    <View>
      <Text style={[styles.title, { color: theme.foreground }]}>Tasks</Text>
      <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
        {isPending ? 'Loading…' : `${total} ${total === 1 ? 'task' : 'tasks'}`}
      </Text>
      <FilterChips value={status} onChange={setStatus} />
    </View>
  );

  if (isError) {
    return (
      <Screen>
        {header}
        <Card>
          <Text style={[styles.cardTitle, { color: theme.destructive }]}>
            {error instanceof NetworkError ? 'No connection' : 'Could not load tasks'}
          </Text>
          <Text style={[styles.meta, { color: theme.cardForeground }]}>{describeError(error)}</Text>
        </Card>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={tasks}
        keyExtractor={(task) => task.id}
        renderItem={({ item }) => <TaskRow task={item} />}
        ListHeaderComponent={header}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshing={isRefetching && !isFetchingNextPage}
        onRefresh={() => void refetch()}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          isPending ? (
            <View style={styles.centred}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : (
            <Card>
              <Text style={[styles.meta, { color: theme.cardForeground }]}>
                {status === 'all'
                  ? 'No tasks yet. You can create them on the web for now.'
                  : `No ${status} tasks.`}
              </Text>
            </Card>
          )
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.centred}>
              <ActivityIndicator color={theme.primary} />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  subtitle: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[1],
    marginBottom: spacing[4],
  },
  cardTitle: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[4] },
  chip: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.medium },
  listContent: { paddingBottom: spacing[6] },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing[3],
    marginBottom: spacing[1],
  },
  taskTitle: {
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
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], marginTop: spacing[2] },
  badge: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight },
  centred: { paddingVertical: spacing[6], alignItems: 'center' },
});
