/**
 * Child task list — the screen where the app's core loop actually happens.
 *
 * Four segments in one screen rather than four screens: **To do**, **Done**, **Returned** and
 * **Available**. The first three mirror the web's tabs exactly — see the note on `Segment` below for
 * why that parity turned out to be a correctness matter and not a styling one. **Available** is the
 * claimable pool, which answers a different question ("what can I pick up?") but sits here because a
 * child moves between the two constantly and a tab each would push the shell's real tabs off a narrow
 * phone.
 *
 * ## Deliberate: no optimistic updates
 *
 * Completing a task is what mints points, advances a streak, and can trip a daily cap or a 409 from a
 * concurrent claim. The server is the only thing that knows the outcome. Showing a task as done and
 * then rolling it back would have a child believing they earned points they did not — the same
 * reasoning that kept the parent approvals queue non-optimistic.
 *
 * ## Deliberate: every claim rule is read, never re-derived
 *
 * `canSelfAssign` comes from the server, which accounts for the pending-primary rule, the claim cap and
 * existing assignments. The web re-derives all of it client-side; doing that here would be a second
 * implementation of one rule, and the two would disagree the first time either moved.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Celebration } from '@/components/Celebration';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import {
  availableTasksQuery,
  completeAssignment,
  INVALIDATED_BY_TASK_ACTION,
  myAssignmentsQuery,
  selfAssign,
  startAssignment,
  type ChildTask,
  type MyAssignment,
} from '@/lib/childTasksApi';
import { dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { isDone } from '@/lib/taskStatus';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

/**
 * Segments mirror the web's tabs, and the parity is not cosmetic — it was a bug.
 *
 * The first version of this screen had one undifferentiated "My tasks" list, which produced two
 * complaints on the first real use:
 *
 * 1. **"The same task repeats."** A daily recurring task has one `TaskAssignment` per day, and they
 *    all carry the parent task's `dueDate`, so four days of "Brush teeth" render as four identical
 *    rows. The web never showed that because its tabs split them by status. Grouping does the same
 *    here, and each row now states which day it is for.
 * 2. **"I rejected a task and can't see it."** `rejected` sorts LAST under the server's
 *    `status: 'asc'` ordering (approved < completed < expired < in_progress < pending < rejected),
 *    so a returned task sank to the bottom of a long list and off the first page. The web has a
 *    dedicated **Returned** tab; without one, a parent's rejection was effectively invisible — the
 *    single worst thing to lose, because it is the one status that asks the child to act again.
 */
type Segment = 'active' | 'completed' | 'returned' | 'available';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'active', label: 'To do' },
  { key: 'completed', label: 'Done' },
  { key: 'returned', label: 'Returned' },
  { key: 'available', label: 'Available' },
];

function SegmentChips({
  value,
  counts,
  onChange,
}: {
  value: Segment;
  counts: Record<Segment, number>;
  onChange: (next: Segment) => void;
}) {
  const theme = useTheme();

  return (
    // Horizontally scrollable: four chips with counts do not fit a narrow phone, and a wrapped
    // second row of chips reads as a different control rather than more of the same one.
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // `flexGrow: 0` stops the ScrollView claiming the leftover vertical space of its parent, and
      // `alignItems: 'center'` stops the chips stretching to whatever height it ends up with. Without
      // both, a horizontal ScrollView's content container defaults to `align-items: stretch` and the
      // chips render as full-height pills down the screen — which is exactly what shipped.
      style={styles.chipScroller}
      contentContainerStyle={styles.chipRow}
    >
      {SEGMENTS.map((segment) => {
        const selected = segment.key === value;
        const count = counts[segment.key];
        return (
          <Pressable
            key={segment.key}
            onPress={() => onChange(segment.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            // The count is part of the name for a screen reader, not a separate unlabelled number.
            accessibilityLabel={`${segment.label}, ${count}`}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? theme.primary : theme.card,
                borderColor: selected ? theme.primary : theme.border,
              },
            ]}
          >
            <AppText
              style={[
                styles.chipLabel,
                { color: selected ? theme.primaryForeground : theme.cardForeground },
              ]}
            >
              {segment.label}
              {count > 0 ? ` ${count}` : ''}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** One of the child's own tasks, with whatever action it currently affords. */
function AssignmentRow({
  item,
  busy,
  onStart,
  onComplete,
}: {
  item: MyAssignment;
  busy: boolean;
  onStart: () => void;
  onComplete: () => void;
}) {
  const theme = useTheme();
  const { task, status } = item;
  const done = isDone(status);
  const due = dueLabel(task.dueDate);

  /**
   * Which day's instance this is.
   *
   * A recurring task has one assignment per day and every one of them carries the *parent task's*
   * `dueDate`, so without this four days of "Brush teeth" are four rows reading "Tomorrow · 5 pts" —
   * indistinguishable, and reported as the app duplicating tasks. `instanceDate` is the only field
   * that separates them, and for a recurring instance it *is* the day the work is owed, so it
   * replaces the parent's due date rather than sitting alongside it.
   *
   * Used bare, with **no "For " prefix**. `dueLabel` already returns whole phrases — "Today",
   * "Tomorrow", "3 days overdue" — so prefixing produced "For 3 days overdue". It shipped that way.
   */
  const instanceLabel = dueLabel(item.instanceDate);
  const showInstance = instanceLabel !== null && instanceLabel !== due;
  const dateLabel = showInstance ? instanceLabel : due;

  // Overdue is judged on whichever date the row is actually showing, so the colour cannot disagree
  // with the words next to it.
  const showOverdue = !done && isOverdue(showInstance ? item.instanceDate : task.dueDate);

  return (
    <Card>
      <AppText style={[styles.taskName, { color: theme.cardForeground }]}>{task.title}</AppText>

      <AppText
        style={[styles.meta, { color: showOverdue ? theme.destructive : theme.mutedForeground }]}
      >
        {[dateLabel, `${task.pointsValue} pts`].filter(Boolean).join(' · ')}
      </AppText>

      {/* Status in words. A rejected task especially must not rely on colour — it is the one state
          that asks the child to do something again. */}
      {status === 'rejected' && (
        <AppText style={[styles.statusLine, { color: theme.destructive }]}>
          Sent back — have another go.
          {item.rejectionReason ? ` "${item.rejectionReason}"` : ''}
        </AppText>
      )}
      {status === 'completed' && (
        <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>
          Done — waiting for a grown-up to check it.
        </AppText>
      )}
      {status === 'approved' && (
        <AppText style={[styles.statusLine, { color: theme.primary }]}>
          Approved. {task.pointsValue} points added.
        </AppText>
      )}
      {status === 'in_progress' && (
        <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>Started</AppText>
      )}

      {task.requiresPhotoEvidence && !done && (
        // Honest about a real gap: the server does not enforce this, so completing without a photo
        // succeeds and the parent gets an approval with nothing attached. Photo capture arrives with
        // the camera work later in this phase; until then, say so rather than silently under-delivering.
        <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>
          This one asks for a photo. You can add one on the website for now.
        </AppText>
      )}

      {!done && (
        <View style={styles.rowActions}>
          {status !== 'in_progress' && (
            <Button label="Start" variant="secondary" onPress={onStart} disabled={busy} />
          )}
          <Button label="I'm done" onPress={onComplete} disabled={busy} />
        </View>
      )}
    </Card>
  );
}

/** A pool task, claimable or explaining why not. */
function AvailableRow({
  task,
  hasPendingPrimaries,
  busy,
  onClaim,
}: {
  task: ChildTask;
  hasPendingPrimaries: boolean;
  busy: boolean;
  onClaim: () => void;
}) {
  const theme = useTheme();
  const due = dueLabel(task.dueDate);

  // The server says no; the child deserves to know which no it is. A row of disabled buttons with no
  // reason is the most common way a rules-heavy screen reads as broken.
  const blockedReason = task.canSelfAssign
    ? null
    : hasPendingPrimaries
      ? 'Finish your current task first.'
      : task.claimsRemaining === 0
        ? 'Someone else already took this one.'
        : 'You can’t pick this one up right now.';

  return (
    <Card>
      <AppText style={[styles.taskName, { color: theme.cardForeground }]}>{task.title}</AppText>
      <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
        {[due, `${task.pointsValue} pts`].filter(Boolean).join(' · ')}
        {task.claimsRemaining !== null ? ` · ${task.claimsRemaining} left` : ''}
      </AppText>

      {blockedReason ? (
        <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>{blockedReason}</AppText>
      ) : (
        <View style={styles.rowActions}>
          <Button label="Pick this up" onPress={onClaim} disabled={busy} />
        </View>
      )}
    </Card>
  );
}

export default function ChildTasks() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>('active');

  /** The assignment whose completion sheet is open, plus its note draft. */
  const [completing, setCompleting] = useState<MyAssignment | null>(null);
  const [note, setNote] = useState('');
  /** Which row is mid-request, so only that row disables rather than the whole list. */
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * The celebration, or null. Deliberately NOT shown for `start` or `claim` — a celebration for
   * picking something up cheapens the one that follows finishing it.
   */
  const [celebrating, setCelebrating] = useState<{ message: string; detail?: string } | null>(null);

  const mine = useInfiniteQuery(myAssignmentsQuery());
  const available = useInfiniteQuery(availableTasksQuery());

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_TASK_ACTION.map((key) => queryClient.invalidateQueries({ queryKey: key }))
    );
  }, [queryClient]);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setActingId(id);
      setActionError(null);
      try {
        await action();
        await invalidate();
        return true;
      } catch (caught) {
        // A 409 here is a real answer, not a bug: a task a co-parent reset, or a pool slot another
        // sibling took a second earlier. Surfaced verbatim rather than retried.
        setActionError(describeError(caught));
        return false;
      } finally {
        setActingId(null);
      }
    },
    [invalidate]
  );

  const { mutateAsync: doStart } = useMutation({ mutationFn: startAssignment });
  const { mutateAsync: doComplete } = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => completeAssignment(id, text),
  });
  const { mutateAsync: doClaim } = useMutation({ mutationFn: selfAssign });

  /**
   * Archived tasks are dropped, matching the web.
   *
   * A parent archiving a task does not delete the assignments already attached to it, so those rows
   * keep arriving from the API. The child can do nothing with them — the action endpoints reject an
   * archived task — so showing them is offering a button that cannot work.
   */
  const assignments = useMemo(() => {
    const flat = (mine.data?.pages.flatMap((p) => p.assignments) ?? []).filter(
      (a) => a.task.status !== 'archived'
    );

    /**
     * Dedupe by id across pages.
     *
     * The cause of the duplicate rows a child reported was server-side — `/tasks/assignments/me`
     * paged over a non-unique sort, so one row could be returned by two pages — and that is fixed
     * at source. This stays as a floor: concatenating independently fetched pages can never be
     * assumed to produce a set, and the failure mode here is a visibly duplicated task plus
     * colliding React keys, which is worse than the cost of a Map.
     */
    return [...new Map(flat.map((a) => [a.id, a])).values()];
  }, [mine.data]);

  /** Split by status, exactly as the web's three tabs do. */
  const byStatus = useMemo(
    () => ({
      active: assignments.filter((a) => a.status === 'pending' || a.status === 'in_progress'),
      completed: assignments.filter((a) => a.status === 'completed' || a.status === 'approved'),
      returned: assignments.filter((a) => a.status === 'rejected'),
    }),
    [assignments]
  );

  const pool = useMemo(
    () => available.data?.pages.flatMap((p) => p.tasks) ?? [],
    [available.data]
  );
  const hasPendingPrimaries = available.data?.pages[0]?.hasPendingPrimaries ?? false;

  const counts: Record<Segment, number> = {
    active: byStatus.active.length,
    completed: byStatus.completed.length,
    returned: byStatus.returned.length,
    available: pool.length,
  };

  const shownAssignments = segment === 'available' ? [] : byStatus[segment];
  const active = segment === 'available' ? available : mine;

  async function confirmComplete() {
    if (!completing) return;
    const points = completing.task.pointsValue;
    const ok = await runAction(completing.id, () =>
      doComplete({ id: completing.id, text: note })
    );
    if (ok) {
      setCompleting(null);
      setNote('');
      /**
       * Worded as pending, not as earned. The points are not banked until a parent approves, and a
       * celebration that says "+10 points!" before that would be contradicted by the tasks list on the
       * very next screen — and by the balance, if the parent rejects it.
       */
      setCelebrating({ message: 'Nice work!', detail: `${points} points once it's approved` });
    }
  }

  if (active.isPending) {
    return (
      <Screen>
        <SegmentChips value={segment} counts={counts} onChange={setSegment} />
        <Card>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (active.isError) {
    const offline = active.error instanceof NetworkError;
    return (
      <Screen scroll>
        <SegmentChips value={segment} counts={counts} onChange={setSegment} />
        <Card>
          <AppText style={[styles.statusLine, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load your tasks'}
          </AppText>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>
            {describeError(active.error)}
          </AppText>
        </Card>
        <View style={styles.actions}>
          <Button label="Try again" onPress={() => void active.refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <SegmentChips value={segment} counts={counts} onChange={setSegment} />

      {actionError !== null && (
        <Card style={{ borderColor: theme.destructive, borderWidth: 1 }}>
          <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
            {actionError}
          </AppText>
        </Card>
      )}

      {segment !== 'available' ? (
        <FlatList
          data={shownAssignments}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AssignmentRow
              item={item}
              busy={actingId === item.id}
              onStart={() => void runAction(item.id, () => doStart(item.id))}
              onComplete={() => {
                setNote('');
                setCompleting(item);
              }}
            />
          )}
          onEndReached={() => {
            if (mine.hasNextPage && !mine.isFetchingNextPage) void mine.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <Card>
              <AppText style={[styles.meta, { color: theme.cardForeground }]}>
                {segment === 'active'
                  ? "Nothing to do right now. Check Available for something to pick up."
                  : segment === 'completed'
                    ? "Nothing finished yet."
                    : "Nothing has been sent back. Good going."}
              </AppText>
            </Card>
          }
          ListFooterComponent={
            mine.isFetchingNextPage ? <ActivityIndicator color={theme.primary} /> : null
          }
        />
      ) : (
        <FlatList
          data={pool}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AvailableRow
              task={item}
              hasPendingPrimaries={hasPendingPrimaries}
              busy={actingId === item.id}
              onClaim={() => void runAction(item.id, () => doClaim(item.id))}
            />
          )}
          onEndReached={() => {
            if (available.hasNextPage && !available.isFetchingNextPage)
              void available.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <Card>
              <AppText style={[styles.meta, { color: theme.cardForeground }]}>
                Nothing to pick up right now.
              </AppText>
            </Card>
          }
          ListFooterComponent={
            available.isFetchingNextPage ? <ActivityIndicator color={theme.primary} /> : null
          }
        />
      )}

      {/*
        Completion asks before it acts. The note is optional, but the confirm step is not: "I'm done"
        is irreversible from the child's side — it goes to a parent for approval — and a mis-tap in a
        scrolling list is easy.
      */}
      <Modal
        visible={completing !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setCompleting(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: theme.card }]}>
            <AppText style={[styles.taskName, { color: theme.cardForeground }]}>
              {completing?.task.title}
            </AppText>
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
              Add a note for your grown-up if you like.
            </AppText>

            <Field
              label="Note (optional)"
              value={note}
              onChangeText={setNote}
              multiline
              maxLength={500}
              editable={actingId === null}
            />

            <View style={styles.rowActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setCompleting(null)}
                disabled={actingId !== null}
              />
              <Button
                label="Yes, I'm done"
                onPress={() => void confirmComplete()}
                busy={actingId !== null}
              />
            </View>
          </View>
        </View>
      </Modal>

      {celebrating && (
        <Celebration
          message={celebrating.message}
          detail={celebrating.detail}
          onDone={() => setCelebrating(null)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chipScroller: { flexGrow: 0, marginBottom: spacing[3] },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.medium },
  taskName: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  statusLine: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[2],
  },
  rowActions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] },
  actions: { marginTop: spacing[4] },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    padding: spacing[5],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    gap: spacing[1],
  },
});
