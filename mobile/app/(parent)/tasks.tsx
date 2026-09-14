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
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { AppText } from '@/components/AppText';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card, type CardStatus } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useToast } from '@/components/Toast';
import { NetworkError } from '@/lib/api';
import { dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { archiveTask, INVALIDATED_BY_PARENT_WRITE, restoreTask } from '@/lib/parentWriteApi';
import { parentTasksQuery, type ParentTask, type TaskFilters } from '@/lib/tasksApi';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

/**
 * The four tabs, and what each one actually asks the server for.
 *
 * "Paused" used to be one of these. It is gone from this app: `paused` is a real `TaskStatus` in the
 * database, but the only thing that can set it is a dropdown on the web edit page, and the owner's
 * position is that pausing a task is not a concept this product has. Completed took its place, which
 * is the state a parent actually looks for.
 *
 * Completed cannot be a `status` value, because completion lives on the ASSIGNMENTS, not the task.
 * `view` is the server-side filter for that (see `VIEW_WHERE` in backend/src/routes/tasks.ts), so
 * paging and the count stay correct. Deriving it here would filter a page after the server had
 * already chosen it, dropping rows and reporting a total for a filter nobody applied.
 *
 * ⚠️ Active and Completed both pin `status: 'active'`, so a task somebody paused on the web appears
 * under All and nowhere else. That is deliberate: the alternative is a "not archived" filter the API
 * does not have, and All is the escape hatch.
 *
 * A task can appear on BOTH Active and Completed at once, and that is correct rather than a
 * duplicate: a daily recurring task whose instance for today has been approved while tomorrow's is
 * already pending is genuinely both. Picking one tab would be wrong for half of every day.
 *
 * `TaskFilters` also carries `childId`, which the backend already accepts, so per-child filtering
 * needs no backend change. An earlier pass replaced the status chips with per-child ones, which lost
 * a real capability (a parent could no longer reach an archived task at all), so that stays reverted
 * until per-child can be added alongside these rather than instead of them.
 */
type TabKey = 'all' | 'active' | 'completed' | 'archived';

const FILTERS: { key: TabKey; label: string; filters: TaskFilters }[] = [
  { key: 'all', label: 'All', filters: {} },
  { key: 'active', label: 'Active', filters: { status: 'active', view: 'open' } },
  // "Completed" is the owner's own word for this tab (see archive-not-delete.test.ts). On a narrow
  // phone the shared switch shrinks the label to fit rather than renaming it.
  { key: 'completed', label: 'Completed', filters: { status: 'active', view: 'done' } },
  { key: 'archived', label: 'Archived', filters: { status: 'archived' } },
];

function FilterChips({
  value,
  onChange,
}: {
  value: TabKey;
  onChange: (next: TabKey) => void;
}) {
  // The same shared switch as the child app's Tasks and Rewards tabs.
  return (
    <SegmentedControl
      options={FILTERS.map((filter) => ({ key: filter.key, label: filter.label }))}
      value={value}
      onChange={onChange}
    />
  );
}

/**
 * A task's stripe, matching the same states the dashboard's approval queue uses: `late` beats
 * `pending` beats no stripe at all, and a task is never both. `done` is deliberately not derived here:
 * "all assignments approved" would need to special-case an unassigned task (zero assignments is not
 * the same as zero *un*approved ones), and the row already says the approved count in words as a pill,
 * so a green stripe would be repeating rather than adding information.
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
/**
 * The action revealed by swiping a row left.
 *
 * Archive for a live task, Restore for an archived one, and never Delete: the row used to have no
 * withdraw action at all here, and the only one mobile offered was a "Delete task" button inside the
 * edit form that called `DELETE /tasks/:id`. That is a soft delete, and every list filters on
 * `deletedAt: null`, so it removed the task from both apps with no route back. The web has only ever
 * offered archive.
 *
 * Rendered at the row's full height so the target is never a sliver, and labelled in words rather
 * than by an icon alone.
 */
function SwipeAction({
  label,
  destructive,
  onPress,
}: {
  label: string;
  destructive: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.swipeAction,
        { backgroundColor: destructive ? theme.destructive : theme.primary },
      ]}
    >
      <AppText
        style={[
          styles.swipeActionLabel,
          // Paired with its own background rather than hardcoded white: `primaryForeground` flips
          // in dark mode, so a literal would fail contrast on one of the two themes.
          { color: destructive ? theme.destructiveForeground : theme.primaryForeground },
        ]}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const DIFFICULTY_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
const RECURRENCE_LABEL: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  weekdays: 'Weekdays',
  weekends: 'Weekends',
};

function TaskRow({ task }: { task: ParentTask }) {
  const theme = useTheme();
  const due = dueLabel(task.dueDate);
  const overdue = isOverdue(task.dueDate) && task.status === 'active';
  const status = taskCardStatus(task);
  const awaiting = task.assignments.filter((a) => a.status === 'completed').length;
  const approved = task.assignments.filter((a) => a.status === 'approved').length;
  const total = task.assignments.length;

  return (
    <Card status={status}>
      <View style={styles.row}>
        {/* The tile turns amber when a child is waiting on this task, so the list scans by colour. */}
        <IconTile
          tone={awaiting > 0 ? 'warning' : 'primary'}
          icon={awaiting > 0 ? 'hourglass' : task.status === 'archived' ? 'archive' : 'checkbox'}
          size={40}
          muted={task.status === 'archived'}
        />
        <View style={styles.grow}>
          <View style={styles.titleRow}>
            <AppText style={[styles.taskTitle, { color: theme.cardForeground }]} numberOfLines={2}>
              {task.title}
            </AppText>
            <Chip compact variant="gold" icon="star" label={`${task.pointsValue} pts`} />
          </View>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
            {total === 0 ? 'Unassigned' : `${total} assigned`}
          </AppText>
          <View style={styles.chips}>
            {awaiting > 0 && <Chip compact variant="pending" icon="hourglass" label={`${awaiting} to approve`} />}
            {approved > 0 && <Chip compact variant="done" icon="checkmark-circle" label={`${approved} approved`} />}
            {/* Overdue is said in words ("N days overdue") as well as coloured, so the state does not
                depend on distinguishing red from grey. */}
            {due !== null && (
              <Chip compact variant={overdue ? 'late' : 'info'} icon="calendar" label={due} />
            )}
            {task.difficulty && <Chip compact variant="xp" label={DIFFICULTY_LABEL[task.difficulty] ?? task.difficulty} />}
            {task.requiresPhotoEvidence && <Chip compact variant="peach" icon="camera" label="Photo" />}
            {task.isRecurring && (
              <Chip
                compact
                variant="info"
                icon="repeat"
                label={task.recurrencePattern ? RECURRENCE_LABEL[task.recurrencePattern] ?? 'Repeats' : 'Repeats'}
              />
            )}
            {task.status !== 'active' && <Chip compact variant="late" icon="archive" label={task.status === 'archived' ? 'Archived' : 'Paused'} />}
          </View>
        </View>
      </View>
    </Card>
  );
}

export default function ParentTasks() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('all');

  /** `all` sends no filter at all: the backend has no 'all' value and rejects one. */
  const filters = useMemo<TaskFilters>(
    () => FILTERS.find((f) => f.key === tab)?.filters ?? {},
    [tab]
  );

  /** The task awaiting an archive confirmation, or null. */
  const [confirming, setConfirming] = useState<ParentTask | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const invalidate = useCallback(
    () =>
      Promise.all(
        INVALIDATED_BY_PARENT_WRITE.map((key) =>
          queryClient.invalidateQueries({ queryKey: key as readonly unknown[] })
        )
      ),
    [queryClient]
  );

  const archive = useMutation({
    mutationFn: archiveTask,
    onSuccess: async () => {
      await invalidate();
      toast.show('Task archived', 'success');
    },
    onError: (caught) => toast.show(describeError(caught), 'error'),
    onSettled: () => setPendingId(null),
  });

  const restore = useMutation({
    mutationFn: restoreTask,
    onSuccess: async () => {
      await invalidate();
      toast.show('Task restored', 'success');
    },
    onError: (caught) => toast.show(describeError(caught), 'error'),
    onSettled: () => setPendingId(null),
  });

  /**
   * Archive asks first, restore does not.
   *
   * Archiving takes a task away from a child mid-week, and a swipe is easy to start by accident
   * while scrolling. Restoring only ever puts something back, so a confirmation there would be
   * friction with nothing behind it.
   */
  const onArchive = useCallback((task: ParentTask) => setConfirming(task), []);

  const onRestore = useCallback(
    (task: ParentTask) => {
      setPendingId(task.id);
      restore.mutate(task.id);
    },
    [restore]
  );

  const confirmArchive = useCallback(() => {
    if (!confirming) return;
    setPendingId(confirming.id);
    archive.mutate(confirming.id);
    setConfirming(null);
  }, [archive, confirming]);

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
      <GradientHeader
        tone="teal"
        icon="checkbox"
        eyebrow="Tasks"
        title={isPending ? 'Loading…' : `${total} ${total === 1 ? 'task' : 'tasks'}`}
        actions={[
          { label: 'New task', icon: 'add', onPress: () => router.push('/(parent)/task-form') },
          {
            label: 'From a template',
            icon: 'sparkles',
            onPress: () => router.push({ pathname: '/(parent)/task-form', params: { template: '1' } }),
          },
        ]}
      />
      <FilterChips value={tab} onChange={setTab} />
    </View>
  );

  if (isError) {
    return (
      <Screen>
        {header}
        <Callout kind="danger" title={error instanceof NetworkError ? 'No connection' : 'Could not load tasks'} live>
          {describeError(error)}
        </Callout>
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
          <ReanimatedSwipeable
            // Right side only: a left-swipe reveals it, matching the Android convention, and there
            // is nothing sensible to put on the other edge.
            renderRightActions={() =>
              item.status === 'archived' ? (
                <SwipeAction label="Restore" destructive={false} onPress={() => onRestore(item)} />
              ) : (
                <SwipeAction label="Archive" destructive onPress={() => onArchive(item)} />
              )
            }
            // Wide enough that a partial swipe does not fire, and the row springs back if released.
            rightThreshold={40}
            overshootRight={false}
            enabled={pendingId !== item.id}
          >
            {/*
              Tapping a row opens the read-first detail screen (state, evidence, comments), not the
              edit form directly: a parent checking who has a task should not land in an editable
              form by accident. The detail screen's own "Edit" button is the route into task-form,
              and it carries the same Archive action for anyone who never finds the swipe.
            */}
            <Pressable
              onPress={() => router.push({ pathname: '/(parent)/task-detail', params: { id: item.id } })}
              accessibilityRole="button"
              accessibilityLabel={`View ${item.title}`}
              // Announced because the gesture is otherwise invisible to a screen reader, which is
              // the whole reason the same action also exists as a button on the detail screen.
              accessibilityHint={
                item.status === 'archived'
                  ? 'Swipe left on this task to restore it'
                  : 'Swipe left on this task to archive it'
              }
            >
              <TaskRow task={item} />
            </Pressable>
          </ReanimatedSwipeable>
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
            <EmptyState
              emoji={tab === 'archived' ? '🗄️' : '📋'}
              title={tab === 'all' ? 'No tasks yet.' : `No ${FILTERS.find((f) => f.key === tab)?.label.toLowerCase()} tasks.`}
              message={tab === 'all' ? 'Tap New task to make one.' : undefined}
            />
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

      {/*
        Archive asks first. It is reversible (the Archived tab restores it), but a child loses the
        task from their list the moment it lands, and a swipe is easy to start by accident while
        scrolling. Android back and a backdrop tap both dismiss it: a sheet that closes only via its
        own button reads as a frozen app.
      */}
      <Modal
        visible={confirming !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setConfirming(null)}
      >
        <Pressable
          style={styles.backdrop}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={() => setConfirming(null)}
        />
        <View style={[styles.sheet, { backgroundColor: theme.card }]}>
          <AppText variant="display" style={[styles.sheetTitle, { color: theme.cardForeground }]}>
            Archive {confirming?.title}?
          </AppText>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
            It disappears from your children&apos;s lists straight away. Nothing already earned is
            taken back, and you can restore it from the Archived tab.
          </AppText>
          <View style={styles.sheetActions}>
            <Button label="Archive" variant="softDanger" onPress={confirmArchive} />
            <Button label="Keep it" variant="secondary" onPress={() => setConfirming(null)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: spacing[6] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  grow: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  taskTitle: {
    flex: 1,
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[2] },
  centred: { paddingVertical: spacing[6], alignItems: 'center' },
  // Full height of whatever row it sits behind, so the target is never a sliver at the top.
  swipeAction: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    minWidth: minTouchTarget * 2,
    // Matches `Card`'s own marginBottom (spacing[4]) so the action ends level with the card it sits
    // behind rather than overhanging into the gap before the next row.
    marginBottom: spacing[4],
    borderRadius: radius.md,
  },
  swipeActionLabel: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.bold,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { padding: spacing[5], borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  sheetTitle: {
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[2],
  },
  sheetActions: { marginTop: spacing[4], gap: spacing[2] },
});
