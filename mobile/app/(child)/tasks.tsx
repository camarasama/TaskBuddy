/**
 * Child task list — the screen where the app's core loop actually happens.
 *
 * Three segments in one screen: **Active**, **Completed** and **Returned**, mirroring the web's tabs
 * exactly, with the claimable pool as an "Available tasks" section inside Active rather than a fourth
 * segment. See the note on `Segment` for why that parity is a correctness matter, not a styling one.
 * (This comment claimed four segments for a while after the pool moved inside Active. It has three.
 * Write PR numbers here without a leading hash: the hex-colour guard reads one as a 3-digit colour.)
 *
 * **Deliberate: no optimistic updates.** Completing a task mints points, advances a streak, and can
 * trip a daily cap or a 409 from a concurrent claim — the server is the only thing that knows the
 * outcome, so nothing here shows a task as done before the server confirms it.
 *
 * **Deliberate: every claim rule is read, never re-derived.** `canSelfAssign` comes from the server,
 * which accounts for the pending-primary rule, the claim cap and existing assignments; re-deriving it
 * here would be a second implementation of one rule, disagreeing the first time either moved.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card, type CardStatus } from '@/components/Card';
import { Celebration } from '@/components/Celebration';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { SegmentedControl } from '@/components/SegmentedControl';
import { NetworkError } from '@/lib/api';
import {
  availableTasksQuery,
  completeAssignment,
  INVALIDATED_BY_TASK_ACTION,
  myAssignmentsQuery,
  selfAssign,
  startAssignment,
  uploadEvidence,
  type ChildTask,
  type MyAssignment,
} from '@/lib/childTasksApi';
import { assignmentDate, dueLabel } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { pickPhoto, type PickedImage } from '@/lib/imageUpload';
import { isDone } from '@/lib/taskStatus';
import { fontSize, fontWeight, onGradient, palette, radius, spacing, useTheme } from '@/theme';

/**
 * Segments mirror the web's tabs, and the parity is not cosmetic — it was a bug. A single
 * undifferentiated list rendered one recurring task as several identical-looking rows (each carries
 * the parent task's `dueDate`, not its own), and let `rejected` sort to the bottom under the server's
 * `status: 'asc'` ordering and off the first page — the one status that most needs to stay visible,
 * because it asks the child to act again. Splitting by status, with a dedicated Returned tab, fixed both.
 */
type Segment = 'active' | 'completed' | 'returned';

/**
 * The same three words the web uses, in the same order.
 *
 * ⚠️ Parity here is a correctness matter, not styling. A child moves between the phone and the
 * browser and has to recognise the same list in both; "To do"/"Done" against "Active"/"Completed"
 * reads as two different apps. Claimable tasks are NOT a fourth segment for the same reason — on the
 * web they are a section inside Active, so that is where they live here too.
 */
const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'returned', label: 'Returned' },
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
  // One shared track rather than this screen's own row of outlined chips; Rewards uses the same one.
  return (
    <SegmentedControl
      options={SEGMENTS.map((segment) => ({ ...segment, count: counts[segment.key] }))}
      value={value}
      onChange={onChange}
    />
  );
}

/** The screen's masthead: what is waiting, in words. Teal, the colour tasks carry on Home. */
function TasksHeader({ counts }: { counts: Record<Segment, number> }) {
  const parts = [
    counts.active > 0 ? `${counts.active} to do` : null,
    counts.returned > 0 ? `${counts.returned} sent back` : null,
  ].filter(Boolean);

  return (
    <GradientHeader
      tone="teal"
      icon="checkbox"
      eyebrow="Tasks"
      title="Your tasks"
      subtitle={parts.length > 0 ? parts.join(' · ') : 'Nothing to do right now'}
    />
  );
}

/** The redesign's 32dp tick: for an undone row it IS the "I'm done" action (same mutation, same
 *  confirmation modal, just a rounder target). `Start` stays a separate button — a different action
 *  the brief does not mention, so dropping it would cut functionality rather than restyle it. */
function TaskTick({ done, busy, onPress, label }: {
  done: boolean;
  busy: boolean;
  onPress: () => void;
  label: string;
}) {
  const theme = useTheme();

  if (done) {
    return (
      <View
        style={[styles.tick, styles.tickDone, { backgroundColor: palette.success[500] }]}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        <Ionicons name="checkmark" size={18} color={onGradient} />
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy }}
      style={({ pressed }) => [styles.tick, { borderColor: theme.border, opacity: pressed ? 0.6 : 1 }]}
    />
  );
}

/**
 * The status of a row as a coloured pill that also says it in words: colour lets a child scan the
 * list, the label is what a screen reader and a colour-blind child get.
 */
function StatusChips({ item }: { item: MyAssignment }) {
  const { task, status } = item;
  const done = isDone(status);

  return (
    <View style={styles.chipRow}>
      {status === 'rejected' && <Chip compact variant="late" icon="arrow-undo" label="Sent back" />}
      {status === 'completed' && <Chip compact variant="xp" icon="hourglass-outline" label="Waiting for a grown-up" />}
      {status === 'approved' && (
        <Chip compact variant="done" icon="checkmark-circle" label={`Approved, +${task.pointsValue} points`} />
      )}
      {status === 'in_progress' && <Chip compact variant="info" icon="play" label="Started" />}
      {task.requiresPhotoEvidence && !done && <Chip compact variant="peach" icon="camera" label="Photo needed" />}
    </View>
  );
}

/** One of the child's own tasks, with whatever action it currently affords. */
function AssignmentRow(
  { item, busy, linked = false, onStart, onComplete }:
  { item: MyAssignment; busy: boolean; linked?: boolean; onStart: () => void; onComplete: () => void }
) {
  const theme = useTheme();
  const { task, status } = item;
  const done = isDone(status);
  // Sortable-by-eye stripe: rejected reads as the one that needs another go, done as finished, and
  // everything else (pending/in_progress) as still open.
  const cardStatus: CardStatus = status === 'rejected' ? 'late' : done ? 'done' : 'pending';

  // Which day's instance this is, preferred over the parent task's `dueDate`. A recurring task has one
  // assignment per day and every one carries the same `dueDate`, so without this, four days of "Brush
  // teeth" are four indistinguishable rows, reported once as the app duplicating tasks. Do NOT collapse
  // these into one row per task; the per-day row is the fix, not the bug. The rule lives in
  // `assignmentDate` so Home cannot drift from it again.
  const date = assignmentDate(item.instanceDate, task.dueDate);
  const showOverdue = !done && date.overdue;

  return (
    // The ring is how "this is the one your notification meant" is said without a sentence of prose
    // that would then sit on the row forever.
    <View style={linked ? [styles.linked, { borderColor: theme.primary }] : undefined}>
    {/* The whole row opens the task. The tick and Start stay as they are — a child who wants to say
        "done" from the list should not have to go through a screen to do it. */}
    <Pressable
      onPress={() => router.push({ pathname: '/(child)/task-detail', params: { assignment: item.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Open "${task.title}"`}
    >
    <Card status={cardStatus}>
      <View style={styles.tickRow}>
        <TaskTick done={done} busy={busy} onPress={onComplete} label={`Mark "${task.title}" done`} />
        <View style={styles.tickRowText}>
          <View style={styles.titleRow}>
            <AppText style={[styles.taskName, styles.grow, { color: theme.cardForeground }]}>{task.title}</AppText>
            <Chip compact variant="gold" icon="star" label={`${task.pointsValue} pts`} />
          </View>
          {date.label && (
            <AppText style={[styles.meta, { color: showOverdue ? theme.destructive : theme.mutedForeground }]}>
              {date.label}
            </AppText>
          )}
          <StatusChips item={item} />
          {/* Status in words: a rejected task especially must not rely on colour alone. */}
          {status === 'rejected' && (
            <AppText style={[styles.statusLine, { color: theme.destructive }]}>
              Have another go.{item.rejectionReason ? ` "${item.rejectionReason}"` : ''}
            </AppText>
          )}
          {/* `Start` survives as a secondary control — see the note on `TaskTick`. */}
          {!done && status !== 'in_progress' && (
            <View style={styles.rowActions}>
              <Button label="Start" variant="soft" onPress={onStart} disabled={busy} />
            </View>
          )}
        </View>
      </View>
    </Card>
    </Pressable>
    </View>
  );
}

/** A pool task, claimable or explaining why not. */
function AvailableRow(
  { task, hasPendingPrimaries, busy, onClaim }:
  { task: ChildTask; hasPendingPrimaries: boolean; busy: boolean; onClaim: () => void }
) {
  const theme = useTheme();
  const due = dueLabel(task.dueDate);

  // The server says no; the child deserves to know which no it is. A row of disabled buttons with no
  // reason is the most common way a rules-heavy screen reads as broken.
  //
  // The pending-primaries reason is NOT repeated here. The section heading already says "Finish your
  // current task first." once for the whole list, and printing it again inside every card made the
  // same sentence appear twice on one screen. The row just says it is locked.
  const blockedReason = task.canSelfAssign
    ? null
    : hasPendingPrimaries
      ? null
      : task.claimsRemaining === 0
        ? 'Someone else already took this one.'
        : 'You can’t pick this one up right now.';
  const lockedByCurrentTask = !task.canSelfAssign && hasPendingPrimaries;

  return (
    /*
      The whole row opens the task, exactly as an assignment row does. This was the one place in the
      app where a child could see a task and not open it, reported about a bonus task: "I can see it
      in child as available but cannot open to see detail."

      It carries `task`, not `assignment`: nobody has claimed this one, so there is no assignment to
      point at yet. The detail screen resolves the two separately.
    */
    <Pressable
      onPress={() => router.push({ pathname: '/(child)/task-detail', params: { task: task.id } })}
      accessibilityRole="button"
      accessibilityLabel={`Open "${task.title}"`}
    >
      <Card>
        <View style={styles.tickRow}>
          <IconTile tone="gold" icon="sparkles" size={40} muted={lockedByCurrentTask} />
          <View style={styles.tickRowText}>
            <View style={styles.titleRow}>
              <AppText style={[styles.taskName, styles.grow, { color: theme.cardForeground }]}>{task.title}</AppText>
              <Chip compact variant="gold" icon="star" label={`${task.pointsValue} pts`} />
            </View>
            {(due || task.claimsRemaining !== null) && (
              <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
                {[due, task.claimsRemaining !== null ? `${task.claimsRemaining} left` : null]
                  .filter(Boolean)
                  .join(' · ')}
              </AppText>
            )}

            {lockedByCurrentTask ? (
              <View style={styles.chipRow}>
                <Chip compact variant="info" icon="lock-closed" label="Locked for now" />
              </View>
            ) : blockedReason ? (
              <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>{blockedReason}</AppText>
            ) : (
              <View style={styles.rowActions}>
                <Button label="Pick this up" onPress={onClaim} disabled={busy} />
              </View>
            )}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

export default function ChildTasks() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>('active');

  /** The assignment whose completion sheet is open, plus its note draft. */
  const [completing, setCompleting] = useState<MyAssignment | null>(null);
  const [note, setNote] = useState('');
  /** The photo chosen in the sheet, not yet uploaded. Cleared whenever the sheet opens or closes. */
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  /** Set when the camera or library was refused, so the sheet can say so instead of doing nothing. */
  const [photoRefused, setPhotoRefused] = useState(false);
  /** Which row is mid-request, so only that row disables rather than the whole list. */
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Deliberately NOT shown for `start` or `claim` — a celebration for picking something up cheapens
  // the one that follows finishing it.
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

  // Archived tasks are dropped, matching the web: a parent archiving a task does not delete the
  // assignments already attached to it, and the action endpoints reject an archived task, so showing
  // these rows would offer a button that cannot work.
  const assignments = useMemo(() => {
    const flat = (mine.data?.pages.flatMap((p) => p.assignments) ?? []).filter(
      (a) => a.task.status !== 'archived'
    );

    // Dedupe by id across pages. The server-side cause (a non-unique sort letting one row appear on
    // two pages) is fixed at source; this stays as a floor since concatenating independently fetched
    // pages can never be assumed to produce a set.
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

  const pool = useMemo(() => available.data?.pages.flatMap((p) => p.tasks) ?? [], [available.data]);
  const hasPendingPrimaries = available.data?.pages[0]?.hasPendingPrimaries ?? false;

  const counts: Record<Segment, number> = {
    active: byStatus.active.length,
    completed: byStatus.completed.length,
    returned: byStatus.returned.length,
  };

  const shownAssignments = byStatus[segment];
  // Claimable tasks are shown under Active, so that segment is the only one that waits on the pool.
  const showPool = segment === 'active' && pool.length > 0;

  /**
   * Deep link from a tapped notification: `/(child)/tasks?assignment=<id>`.
   *
   * A notification is about one assignment, and this screen files assignments under three segments,
   * so without this the child lands on whichever segment they last looked at and has to guess.
   * Switching the segment is all that is done here; the row is then marked.
   *
   * ⚠️ **This used to be guarded by a one-shot boolean, and that was a bug.** This screen is a tab,
   * so it is mounted once and kept for the life of the app: once `consumedLink` went true it never
   * went back, and every notification tapped after the first was ignored. The child stayed on
   * whatever segment the FIRST link had chosen, which is exactly how it was reported, "it sends me
   * to the return tab instead of the right item I clicked on". The earlier tap had been a returned
   * task. Same family as the web's PR 182: the param changes, and something that only looks once
   * never notices.
   *
   * So the guard is now the id itself, and the param is cleared once used. Clearing matters for the
   * repeat case: tapping the SAME notification twice leaves the param identical, and without
   * clearing there is no change for this effect to see.
   *
   * Note the limit, which is not a bug to fix here: a `task_comment` notification can only bring the
   * child to the row. The mobile app has no child-side comment thread, so the comment itself is
   * still web-only.
   */
  const { assignment: linkedIdParam } = useLocalSearchParams<{ assignment?: string }>();
  const [linkedId, setLinkedId] = useState<string | null>(null);

  useEffect(() => {
    if (!linkedIdParam) return;

    const found = assignments.find((a) => a.id === linkedIdParam);
    if (!found) return;

    setSegment(
      found.status === 'rejected'
        ? 'returned'
        : found.status === 'completed' || found.status === 'approved'
          ? 'completed'
          : 'active'
    );
    setLinkedId(found.id);
    // Consumed. Dropping it also means a later tap on another segment is never yanked back, which
    // is what the old boolean was really for.
    router.setParams({ assignment: undefined });
  }, [assignments, linkedIdParam]);

  /**
   * Page forward while the linked assignment has not turned up.
   *
   * Without this, a notification about anything not on page one silently did nothing at all: the
   * effect above returns early when `found` is undefined and never runs again. Same reasoning as
   * `task-detail`, which already walks its pages for exactly this case.
   */
  useEffect(() => {
    if (!linkedIdParam || linkedId === linkedIdParam) return;
    if (assignments.some((a) => a.id === linkedIdParam)) return;
    if (!mine.hasNextPage || mine.isFetchingNextPage) return;
    void mine.fetchNextPage();
  }, [assignments, linkedId, linkedIdParam, mine]);

  /** Every open starts clean: a photo left over from the last task would attach to this one. */
  function openSheet(item: MyAssignment) {
    setNote('');
    setPhoto(null);
    setPhotoRefused(false);
    setCompleting(item);
  }

  function closeSheet() {
    setCompleting(null);
    setPhoto(null);
    setPhotoRefused(false);
  }

  /** Open the camera or the library, and remember what came back. */
  async function choosePhoto(source: 'camera' | 'library') {
    setPhotoBusy(true);
    setPhotoRefused(false);
    setActionError(null);
    try {
      const picked = await pickPhoto(source);
      // null is a cancel or a refusal, and the two are indistinguishable from here. Saying "you can
      // still finish without it" covers both and is true either way.
      if (picked) setPhoto(picked);
      else setPhotoRefused(true);
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function confirmComplete() {
    if (!completing) return;
    const points = completing.task.pointsValue;
    const chosen = photo;

    // Photo first: the upload writes the evidence row against this assignment, so a failure here must
    // NOT go on to submit. Completing is what a parent sees; submitting a photo-required task with the
    // photo silently dropped is worse than not submitting at all, because it looks finished.
    const ok = await runAction(completing.id, async () => {
      if (chosen) await uploadEvidence(completing.id, chosen);
      return doComplete({ id: completing.id, text: note });
    });

    if (ok) {
      setCompleting(null);
      setNote('');
      setPhoto(null);
      setPhotoRefused(false);
      // Worded as pending, not as earned — the points are not banked until a parent approves.
      setCelebrating({ message: 'Nice work!', detail: `${points} points once it's approved` });
    }
  }

  if (mine.isPending) {
    return (
      <Screen>
        <TasksHeader counts={counts} />
        <SegmentChips value={segment} counts={counts} onChange={setSegment} />
        <Card>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (mine.isError) {
    const offline = mine.error instanceof NetworkError;
    return (
      <Screen scroll>
        <TasksHeader counts={counts} />
        <SegmentChips value={segment} counts={counts} onChange={setSegment} />
        <Card status="late">
          <AppText style={[styles.statusLine, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load your tasks'}
          </AppText>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>{describeError(mine.error)}</AppText>
        </Card>
        <View style={styles.actions}>
          <Button label="Try again" onPress={() => void mine.refetch()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {actionError !== null && (
        <Card status="late">
          <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
            {actionError}
          </AppText>
        </Card>
      )}

      <FlatList
        data={shownAssignments}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <AssignmentRow
            item={item}
            busy={actingId === item.id}
            linked={linkedId === item.id}
            onStart={() => void runAction(item.id, () => doStart(item.id))}
            onComplete={() => { openSheet(item); }}
          />
        )}
        onEndReached={() => {
          if (mine.hasNextPage && !mine.isFetchingNextPage) void mine.fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        // The masthead and the switch scroll with the list, so a short phone is not left with half its
        // height pinned to a header.
        ListHeaderComponent={
          <>
            <TasksHeader counts={counts} />
            <SegmentChips value={segment} counts={counts} onChange={setSegment} />
          </>
        }
        ListEmptyComponent={
          // Not rendered as "nothing here" when there are tasks to pick up below — an empty message
          // sitting above a list of claimable tasks contradicts itself.
          segment === 'active' && showPool ? null : segment === 'active' ? (
            <EmptyState emoji="✅" title="Nothing to do right now." />
          ) : segment === 'completed' ? (
            <EmptyState emoji="📋" title="Nothing finished yet." />
          ) : (
            <EmptyState emoji="👍" title="Nothing has been sent back. Good going." />
          )
        }
        ListFooterComponent={
          <>
            {/*
              Claimable tasks live under Active, exactly as they do on the web — a task a child can
              pick up is a task they can do now, and putting them behind a fourth tab hid the one
              thing the pool exists for.
            */}
            {showPool && (
              <View style={styles.poolBlock}>
                {/* Said once, here, for the whole section. Each locked card only shows a lock. */}
                <SectionTitle
                  title="Available tasks"
                  icon="sparkles"
                  tone="gold"
                  hint={hasPendingPrimaries ? 'Finish your current task first.' : 'Tasks you can pick up yourself.'}
                />
                {pool.map((task) => (
                  <AvailableRow
                    key={task.id}
                    task={task}
                    hasPendingPrimaries={hasPendingPrimaries}
                    busy={actingId === task.id}
                    onClaim={() => void runAction(task.id, () => doClaim(task.id))}
                  />
                ))}
              </View>
            )}
            {(mine.isFetchingNextPage || (segment === 'active' && available.isFetching)) && (
              <ActivityIndicator color={theme.primary} />
            )}
          </>
        }
      />

      {/* Completion asks before it acts: "I'm done" is irreversible from the child's side, and a
          mis-tap in a scrolling list is easy. The note itself is optional. */}
      <Modal
        visible={completing !== null}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalSheet, { backgroundColor: theme.card }]}>
            <AppText variant="display" style={[styles.sheetTitle, { color: theme.cardForeground }]}>
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

            {/* Offered only where the task asks for one. Never a gate: the server does not require a
                photo either, and a refused camera on a supervised device would otherwise trap a child
                in a task they cannot submit. */}
            {completing?.task.requiresPhotoEvidence && (
              <View style={styles.photoBlock}>
                <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
                  {photo
                    ? 'Photo ready to send.'
                    : 'This one asks for a photo, so your grown-up can see it is done.'}
                </AppText>

                {photo && (
                  <Image
                    source={{ uri: photo.uri }}
                    style={styles.photoPreview}
                    accessibilityLabel="The photo you chose"
                  />
                )}

                <View style={styles.rowActions}>
                  <Button
                    label={photo ? 'Take a different one' : 'Take a photo'}
                    variant="soft"
                    onPress={() => void choosePhoto('camera')}
                    busy={photoBusy}
                    disabled={actingId !== null}
                  />
                  <Button
                    label="Choose a photo"
                    variant="soft"
                    onPress={() => void choosePhoto('library')}
                    busy={photoBusy}
                    disabled={actingId !== null}
                  />
                </View>

                {photoRefused && !photo && (
                  <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>
                    No photo added. You can still finish the task without one.
                  </AppText>
                )}
              </View>
            )}

            <View style={styles.rowActions}>
              <Button label="Cancel" variant="secondary" onPress={closeSheet} disabled={actingId !== null} />
              <Button label="Yes, I'm done" onPress={() => void confirmComplete()} busy={actingId !== null} />
            </View>
          </View>
        </View>
      </Modal>

      {celebrating && (
        <Celebration message={celebrating.message} detail={celebrating.detail} onDone={() => setCelebrating(null)} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tickRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  tickRowText: { flex: 1 },
  tick: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tickDone: { borderWidth: 0 },
  linked: { borderWidth: 2, borderRadius: radius.lg },
  poolBlock: { marginTop: spacing[2] },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  grow: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2], marginTop: spacing[2] },
  sheetTitle: { fontSize: fontSize.lg.fontSize, lineHeight: fontSize.lg.lineHeight, fontWeight: fontWeight.bold },
  taskName: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.semibold },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  statusLine: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[2] },
  rowActions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] },
  photoBlock: { marginTop: spacing[3], gap: spacing[1] },
  // 4:3 rather than square: the picker no longer crops, so a portrait shot would otherwise be
  // squashed in the preview and look like the upload had damaged it.
  photoPreview: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, marginTop: spacing[2] },
  actions: { marginTop: spacing[4] },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: { padding: spacing[5], borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, gap: spacing[1] },
});
