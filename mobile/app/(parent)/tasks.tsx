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
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { useInfiniteQuery } from '@tanstack/react-query';

import { Button } from '@/components/Button';
import { Card, type CardStatus } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { parentTasksQuery, type ParentTask, type TaskFilters } from '@/lib/tasksApi';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

/**
 * `'all'` or a status. `TaskFilters` also has a `childId` param the backend already accepts, so
 * per-child filtering is possible without any backend change, it is just not wired into this chip row.
 * An earlier pass replaced the status chips with per-child ones, which turned out to be a real
 * capability loss (a parent could no longer reach a paused or archived task from here at all), so
 * that stays reverted until per-child filtering can be added alongside status rather than instead of it.
 */
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
  return (
    <View style={styles.chipRow}>
      {FILTERS.map((filter) => (
        <Chip
          key={filter.key}
          label={filter.label}
          // Settled pairing for a filter chip: `primary` (filled) for the selected one, `info` (tinted)
          // for the rest. Left undecided by the primitives unit, now fixed here for every filter chip
          // in the app.
          variant={filter.key === value ? 'primary' : 'info'}
          selected={filter.key === value}
          onPress={() => onChange(filter.key)}
        />
      ))}
    </View>
  );
}

/**
 * A task's stripe, matching the same states the dashboard's approval queue uses: `late` beats
 * `pending` beats no stripe at all, and a task is never both. `done` is deliberately not derived here:
 * "all assignments approved" would need to special-case an unassigned task (zero assignments is not
 * the same as zero *un*approved ones), and the row already says the approved count in words via
 * `assignmentSummary`, so a green stripe would be repeating rather than adding information.
 */
function taskCardStatus(task: ParentTask): CardStatus | undefined {
  if (isOverdue(task.dueDate) && task.status === 'active') return 'late';
  if (task.assignments.some((assignment) => assignment.status === 'completed')) return 'pending';
  return undefined;
}

/** 0 sorts first. Late beats pending beats everything else, matching `taskCardStatus`'s own priority. */
function taskPriority(task: ParentTask): number {
  const status = taskCardStatus(task);
  if (status === 'late') return 0;
  if (status === 'pending') return 1;
  return 2;
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
    <Card status={taskCardStatus(task)}>
      <View style={styles.rowHeader}>
        <AppText style={[styles.taskTitle, { color: theme.cardForeground }]} numberOfLines={2}>
          {task.title}
        </AppText>
        <AppText style={[styles.points, { color: theme.foreground }]}>{task.pointsValue} pts</AppText>
      </View>

      <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
        {assignmentSummary(task)}
      </AppText>

      <View style={styles.badgeRow}>
        {due !== null && (
          // Overdue is said in words ("N days overdue") as well as coloured, so the state does not
          // depend on distinguishing red from grey.
          <AppText
            style={[styles.badge, { color: overdue ? theme.destructive : theme.mutedForeground }]}
          >
            {due}
          </AppText>
        )}
        {task.difficulty && (
          <AppText style={[styles.badge, { color: theme.mutedForeground }]}>{task.difficulty}</AppText>
        )}
        {task.status !== 'active' && (
          <AppText style={[styles.badge, { color: theme.mutedForeground }]}>{task.status}</AppText>
        )}
        {task.requiresPhotoEvidence && (
          <AppText style={[styles.badge, { color: theme.mutedForeground }]}>photo required</AppText>
        )}
      </View>
    </Card>
  );
}

export default function ParentTasks() {
  const theme = useTheme();
  const [status, setStatus] = useState<StatusFilter>('all');

  // `all` means "send no status param": the backend has no 'all' value and rejects one.
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

  // Sorted, not just fetched-order: the redesign wants late and pending tasks to read first. This only
  // reorders whichever page(s) are already loaded, it does not ask the server for a different order,
  // so a task that arrives on a later page can still appear above one already on screen. Acceptable for
  // a family's task list (rarely more than one page deep) but worth knowing about before this pattern
  // is copied onto a longer list.
  const tasks = useMemo(() => {
    const flat = data?.pages.flatMap((page) => page.tasks) ?? [];
    return [...flat].sort((a, b) => taskPriority(a) - taskPriority(b));
  }, [data]);
  const total = data?.pages[0]?.pagination.total ?? 0;

  const onEndReached = useCallback(() => {
    // Guarded: FlatList fires this repeatedly while near the end, and without the check every fire
    // would queue another page request.
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const header = (
    <View>
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>Tasks</AppText>
      <AppText style={[styles.subtitle, { color: theme.mutedForeground }]}>
        {isPending ? 'Loading…' : `${total} ${total === 1 ? 'task' : 'tasks'}`}
      </AppText>
      <FilterChips value={status} onChange={setStatus} />
      <View style={styles.headerAction}>
        <Button label="New task" onPress={() => router.push('/(parent)/task-form')} />
      </View>
    </View>
  );

  if (isError) {
    return (
      <Screen>
        {header}
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.destructive }]}>
            {error instanceof NetworkError ? 'No connection' : 'Could not load tasks'}
          </AppText>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>{describeError(error)}</AppText>
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
        renderItem={({ item }) => (
          // Tapping a row opens the read-first detail screen (state, evidence, comments), not the
          // edit form directly — a parent checking who has a task should not land in an editable form
          // by accident. The detail screen's own "Edit" button is the route into task-form.
          <Pressable
            onPress={() => router.push({ pathname: '/(parent)/task-detail', params: { id: item.id } })}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.title}`}
          >
            <TaskRow task={item} />
          </Pressable>
        )}
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
              <AppText style={[styles.meta, { color: theme.cardForeground }]}>
                {status === 'all'
                  ? 'No tasks yet. You can create them on the web for now.'
                  : `No ${status} tasks.`}
              </AppText>
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
  headerAction: { marginBottom: spacing[3] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[4] },
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
