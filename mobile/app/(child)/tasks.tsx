/**
 * Child task list — the screen where the app's core loop actually happens.
 *
 * Two segments rather than two screens: **Mine** (what this child holds) and **Available** (the pool
 * they may claim from). They answer different questions — "what do I owe?" and "what can I pick up?" —
 * but a child moves between them constantly, and a tab each would push the rest of the shell's tabs off
 * a narrow phone.
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
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
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

type Segment = 'mine' | 'available';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'mine', label: 'My tasks' },
  { key: 'available', label: 'Available' },
];

function SegmentChips({ value, onChange }: { value: Segment; onChange: (next: Segment) => void }) {
  const theme = useTheme();

  return (
    <View style={styles.chipRow}>
      {SEGMENTS.map((segment) => {
        const selected = segment.key === value;
        return (
          <Pressable
            key={segment.key}
            onPress={() => onChange(segment.key)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
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
            </AppText>
          </Pressable>
        );
      })}
    </View>
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
  const overdue = !done && isOverdue(task.dueDate);
  const due = dueLabel(task.dueDate);

  return (
    <Card>
      <AppText style={[styles.taskName, { color: theme.cardForeground }]}>{task.title}</AppText>

      <AppText style={[styles.meta, { color: overdue ? theme.destructive : theme.mutedForeground }]}>
        {[due, `${task.pointsValue} pts`].filter(Boolean).join(' · ')}
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
  const [segment, setSegment] = useState<Segment>('mine');

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

  const assignments = useMemo(
    () => mine.data?.pages.flatMap((p) => p.assignments) ?? [],
    [mine.data]
  );
  const pool = useMemo(
    () => available.data?.pages.flatMap((p) => p.tasks) ?? [],
    [available.data]
  );
  const hasPendingPrimaries = available.data?.pages[0]?.hasPendingPrimaries ?? false;

  const active = segment === 'mine' ? mine : available;

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
        <SegmentChips value={segment} onChange={setSegment} />
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
        <SegmentChips value={segment} onChange={setSegment} />
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
      <SegmentChips value={segment} onChange={setSegment} />

      {actionError !== null && (
        <Card style={{ borderColor: theme.destructive, borderWidth: 1 }}>
          <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
            {actionError}
          </AppText>
        </Card>
      )}

      {segment === 'mine' ? (
        <FlatList
          data={assignments}
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
                No tasks yet. Check the Available tab for something to pick up.
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
  chipRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] },
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
