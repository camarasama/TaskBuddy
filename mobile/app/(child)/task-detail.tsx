/**
 * Child task detail — the screen a child had no way to reach.
 *
 * The parent app has had `task-detail` since the start; the child side had nothing. Rows on the home
 * tab were plain `View`s and rows on the tasks tab exposed only a tick and a Start button, so
 * "opening" a task did nothing on either tab. A finished task was the worst case: the list shows a
 * status word and no reason, so a child whose work was sent back could not read why anywhere in the
 * app.
 *
 * ## Deliberate: the assignment comes from the list query, not a fetch of its own
 *
 * `GET /tasks/assignments/:id` is `requireParent`, so a child cannot read one directly. Rather than
 * widen a parent-scoped endpoint, this screen reads the same infinite query the tasks tab already
 * fills, and pages forward only if the id is not in what is loaded. That also means opening a task
 * costs no request at all in the common case, and an action taken here invalidates exactly the keys
 * the list already listens to, so both screens move together.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Celebration } from '@/components/Celebration';
import { Field } from '@/components/Field';
import { PhotoViewer } from '@/components/PhotoViewer';
import { Screen } from '@/components/Screen';
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
import { dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { pickPhoto, type PickedImage } from '@/lib/imageUpload';
import { isDone } from '@/lib/taskStatus';
import { fontSize, fontWeight, palette, radius, spacing, useTheme } from '@/theme';

/** What the child is told their task is currently doing. Words, never colour alone. */
const STATUS_LINE: Record<string, string> = {
  pending: 'Not started yet.',
  in_progress: 'Started. Finish it when you are ready.',
  completed: 'Done — waiting for a grown-up to check it.',
  approved: 'Approved. Nice work.',
  rejected: 'Sent back — have another go.',
  expired: 'This one ran out of time.',
};

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <AppText style={[styles.rowLabel, { color: theme.mutedForeground }]}>{label}</AppText>
      <AppText style={[styles.rowValue, { color: theme.cardForeground }]}>{value}</AppText>
    </View>
  );
}

export default function ChildTaskDetail() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  /**
   * Opened one of two ways, and they are not the same kind of row.
   *
   * `assignment` is one of the child's own tasks. `task` is a **pool task nobody has claimed**, which
   * has no assignment to point at yet. The Available list used to be the one place in the app a child
   * could see a task and not open it, reported as "I can see it in child as available but cannot open
   * to see detail" about a bonus task.
   */
  const { assignment: assignmentId, task: poolTaskId } = useLocalSearchParams<{
    assignment?: string;
    task?: string;
  }>();

  const mine = useInfiniteQuery(myAssignmentsQuery());

  // Only fetched when the screen was actually opened on a pool task, so an ordinary open costs
  // nothing extra.
  const pool = useInfiniteQuery({ ...availableTasksQuery(), enabled: Boolean(poolTaskId) });

  const assignment: MyAssignment | undefined = mine.data?.pages
    .flatMap((p) => p.assignments)
    .find((a) => a.id === assignmentId);

  const poolTask: ChildTask | undefined = pool.data?.pages
    .flatMap((p) => p.tasks)
    .find((t) => t.id === poolTaskId);

  /**
   * Page forward until the id turns up.
   *
   * A child arriving from a notification may not have opened the tasks tab at all, and an assignment
   * from last week is not on page one. Without this the screen would say "not found" for a task that
   * exists, which is the same bug as showing an empty list.
   */
  useEffect(() => {
    // Skipped entirely on a pool task: its id is a TASK id and will never match an assignment, so
    // paging the whole history looking for it would just be a slow way to reach the same answer.
    if (poolTaskId || assignment || !mine.hasNextPage || mine.isFetchingNextPage) return;
    void mine.fetchNextPage();
  }, [assignment, poolTaskId, mine]);

  /** The same walk for the pool, which is paginated too. */
  useEffect(() => {
    if (!poolTaskId || poolTask || !pool.hasNextPage || pool.isFetchingNextPage) return;
    void pool.fetchNextPage();
  }, [poolTaskId, poolTask, pool]);

  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<PickedImage | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoRefused, setPhotoRefused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState<{ message: string; detail?: string } | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);

  const { mutateAsync: doStart } = useMutation({ mutationFn: startAssignment });
  const { mutateAsync: doComplete } = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => completeAssignment(id, text),
  });

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await Promise.all(
        INVALIDATED_BY_TASK_ACTION.map((key) => queryClient.invalidateQueries({ queryKey: key }))
      );
      return true;
    } catch (caught) {
      // A 409 is a real answer here, not a fault: a co-parent may have reset or archived this task
      // while the screen was open. Shown verbatim rather than retried.
      setActionError(describeError(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function choosePhoto(source: 'camera' | 'library') {
    setPhotoBusy(true);
    setPhotoRefused(false);
    setActionError(null);
    try {
      const picked = await pickPhoto(source);
      // null is a cancel or a refusal and the two are indistinguishable from here; either way the
      // task can still be finished without one.
      if (picked) setPhoto(picked);
      else setPhotoRefused(true);
    } catch (caught) {
      setActionError(describeError(caught));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function submit() {
    if (!assignment) return;
    const points = assignment.task.pointsValue;
    const chosen = photo;

    // Photo first, and a failure here must NOT go on to submit. Submitting a photo-required task
    // with the photo silently dropped looks finished to a parent, which is worse than not
    // submitting at all.
    const ok = await run(async () => {
      if (chosen) await uploadEvidence(assignment.id, chosen);
      return doComplete({ id: assignment.id, text: note });
    });

    if (ok) {
      setNote('');
      setPhoto(null);
      setPhotoRefused(false);
      // Worded as pending: the points are not banked until a parent approves.
      setCelebrating({ message: 'Nice work!', detail: `${points} points once it's approved` });
    }
  }

  // ── A pool task nobody has claimed ─────────────────────────────────────────

  if (poolTaskId) {
    if (pool.isPending || (!poolTask && pool.hasNextPage)) {
      return (
        <Screen>
          <Card>
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Loading…</AppText>
          </Card>
        </Screen>
      );
    }

    if (!poolTask) {
      return (
        <Screen scroll>
          <Card>
            <AppText style={[styles.statusLine, { color: theme.cardForeground }]}>
              That task is not up for grabs any more. Someone may have taken it.
            </AppText>
          </Card>
          <View style={styles.actions}>
            <Button label="Back to tasks" onPress={() => router.replace('/(child)/tasks')} />
          </View>
        </Screen>
      );
    }

    // The same reasons the list gives, so opening a blocked task does not lose the explanation.
    const blockedReason = poolTask.canSelfAssign
      ? null
      : poolTask.claimsRemaining === 0
        ? 'Someone else already took this one.'
        : 'You can’t pick this one up right now. Finish your current task first.';

    return (
      <Screen scroll>
        <Card status="pending">
          <AppText style={[styles.title, { color: theme.cardForeground }]}>{poolTask.title}</AppText>
          <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>
            Nobody has taken this one yet.
          </AppText>

          {poolTask.description ? (
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              {poolTask.description}
            </AppText>
          ) : null}

          <Row label="Worth" value={`${poolTask.pointsValue} points`} />
          {dueLabel(poolTask.dueDate) ? (
            <Row label="Due" value={dueLabel(poolTask.dueDate) as string} />
          ) : null}
          {poolTask.estimatedMinutes != null ? (
            <Row label="Should take" value={`${poolTask.estimatedMinutes} min`} />
          ) : null}
          {poolTask.claimsRemaining != null ? (
            <Row
              label="Spots left"
              value={`${poolTask.claimsRemaining}`}
            />
          ) : null}
          {poolTask.requiresPhotoEvidence ? (
            <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>
              This one asks for a photo when you finish.
            </AppText>
          ) : null}
        </Card>

        {actionError !== null && (
          <Card status="late">
            <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
              {actionError}
            </AppText>
          </Card>
        )}

        <View style={styles.actions}>
          {blockedReason ? (
            <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>
              {blockedReason}
            </AppText>
          ) : (
            <Button
              label="Pick this up"
              busy={busy}
              onPress={() => {
                void run(() => selfAssign(poolTask.id)).then((ok) => {
                  // Once claimed it is an assignment, and the id in the params is the task's. Going
                  // back to the list is more honest than leaving the child on a screen that no
                  // longer describes what they are looking at.
                  if (ok) router.replace('/(child)/tasks');
                });
              }}
            />
          )}
        </View>

        <View style={styles.actions}>
          <Button label="Back to tasks" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  // ── One of the child's own tasks ───────────────────────────────────────────

  if (mine.isPending || (!assignment && mine.hasNextPage)) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (!assignment) {
    return (
      <Screen scroll>
        <Card>
          <AppText style={[styles.statusLine, { color: theme.cardForeground }]}>
            We couldn&apos;t find that task. A grown-up may have removed it.
          </AppText>
        </Card>
        <View style={styles.actions}>
          <Button label="Back to tasks" onPress={() => router.replace('/(child)/tasks')} />
        </View>
      </Screen>
    );
  }

  const { task, status } = assignment;
  const done = isDone(status);
  const overdue = !done && isOverdue(task.dueDate);
  const photos = assignment.evidence?.filter((e) => e.fileUrl || e.thumbnailUrl) ?? [];

  return (
    <Screen scroll>
      <Card status={status === 'rejected' ? 'late' : done ? 'done' : 'pending'}>
        <AppText style={[styles.title, { color: theme.cardForeground }]}>{task.title}</AppText>
        <AppText style={[styles.statusLine, { color: status === 'rejected' ? theme.destructive : theme.mutedForeground }]}>
          {STATUS_LINE[status] ?? status}
        </AppText>

        {task.description ? (
          <AppText style={[styles.body, { color: theme.cardForeground }]}>{task.description}</AppText>
        ) : null}

        <Row label="Worth" value={`${task.pointsValue} points`} />
        {dueLabel(task.dueDate) ? (
          <Row label="Due" value={dueLabel(task.dueDate) as string} />
        ) : null}
        {dueLabel(assignment.instanceDate) ? (
          <Row label="For" value={dueLabel(assignment.instanceDate) as string} />
        ) : null}
        {status === 'approved' && assignment.pointsAwarded != null ? (
          <Row label="Earned" value={`${assignment.pointsAwarded} points`} />
        ) : null}
        {overdue ? (
          <AppText style={[styles.statusLine, { color: theme.destructive }]}>This one is late.</AppText>
        ) : null}
      </Card>

      {/* The single most important thing on a sent-back task, and the list has never shown it. */}
      {status === 'rejected' && assignment.rejectionReason ? (
        <Card status="late">
          <AppText style={[styles.rowLabel, { color: theme.mutedForeground }]}>What to fix</AppText>
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {assignment.rejectionReason}
          </AppText>
        </Card>
      ) : null}

      {photos.length > 0 && (
        <Card>
          <AppText style={[styles.rowLabel, { color: theme.mutedForeground }]}>Your photo</AppText>
          {photos.map((evidence) => (
            <Pressable
              key={evidence.id}
              onPress={() => setViewingPhoto((evidence.fileUrl || evidence.thumbnailUrl) as string)}
              accessibilityRole="imagebutton"
              accessibilityLabel="Open the photo you sent"
            >
              <Image
                source={{ uri: (evidence.thumbnailUrl || evidence.fileUrl) as string }}
                style={styles.photo}
              />
            </Pressable>
          ))}
        </Card>
      )}

      {actionError !== null && (
        <Card status="late">
          <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
            {actionError}
          </AppText>
        </Card>
      )}

      {/* Actions only where there is one to take. A finished task is a thing to read, not to act on. */}
      {!done && status !== 'expired' && (
        <Card>
          {status === 'pending' && (
            <View style={styles.actions}>
              <Button
                label="Start"
                variant="secondary"
                onPress={() => void run(() => doStart(assignment.id))}
                busy={busy}
              />
            </View>
          )}

          <Field
            label="Note for your grown-up (optional)"
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={500}
            editable={!busy}
          />

          {/* Offered where the task asks for one, never required: the server does not require it
              either, and a refused camera on a supervised device would otherwise trap a child in a
              task they cannot submit. */}
          {task.requiresPhotoEvidence && (
            <View style={styles.photoBlock}>
              <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
                {photo
                  ? 'Photo ready to send.'
                  : 'This one asks for a photo, so your grown-up can see it is done.'}
              </AppText>

              {photo && <Image source={{ uri: photo.uri }} style={styles.photo} accessibilityLabel="The photo you chose" />}

              <View style={styles.actions}>
                <Button
                  label={photo ? 'Take a different one' : 'Take a photo'}
                  variant="secondary"
                  onPress={() => void choosePhoto('camera')}
                  busy={photoBusy}
                  disabled={busy}
                />
                <Button
                  label="Choose a photo"
                  variant="secondary"
                  onPress={() => void choosePhoto('library')}
                  busy={photoBusy}
                  disabled={busy}
                />
              </View>

              {photoRefused && !photo && (
                <AppText style={[styles.statusLine, { color: theme.mutedForeground }]}>
                  No photo added. You can still finish the task without one.
                </AppText>
              )}
            </View>
          )}

          <View style={styles.actions}>
            <Button
              label={status === 'rejected' ? 'Send it again' : "I'm done"}
              onPress={() => void submit()}
              busy={busy}
            />
          </View>
        </Card>
      )}

      <View style={styles.actions}>
        <Button label="Back to tasks" variant="secondary" onPress={() => router.back()} />
      </View>

      {mine.isFetching && <ActivityIndicator color={theme.primary} />}

      <PhotoViewer uri={viewingPhoto} onClose={() => setViewingPhoto(null)} />

      {celebrating && (
        <Celebration
          message={celebrating.message}
          detail={celebrating.detail}
          onDone={() => {
            setCelebrating(null);
            router.back();
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.lg.fontSize, lineHeight: fontSize.lg.lineHeight, fontWeight: fontWeight.semibold },
  body: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, marginTop: spacing[2] },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  statusLine: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3], marginTop: spacing[2] },
  rowLabel: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  rowValue: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, fontWeight: fontWeight.medium },
  actions: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] },
  photoBlock: { marginTop: spacing[3], gap: spacing[1] },
  // 4:3 rather than square: the picker does not crop, so a portrait shot would be squashed and look
  // like the upload had damaged it.
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, marginTop: spacing[2], backgroundColor: palette.slate[200] },
});
