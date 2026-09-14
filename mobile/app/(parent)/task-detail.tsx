/**
 * Read-first task detail — the screen mobile never had. Tapping a task used to jump straight into the
 * edit form; this shows state first (per-child assignment, evidence, comments) and offers exactly two
 * actions (restore an assignment, edit the task) rather than doubling as a second edit surface.
 *
 * Ported from `frontend/src/app/parent/tasks/[id]/page.tsx` against the real `GET /tasks/:id` response
 * (`parentWriteApi.fetchTask` — the same request task-form already makes, widened, see `TaskDetail`).
 * Two things on the web page do NOT carry over, both because the API cannot back them, not oversights:
 *  - `xpValue` — the web's own type calls it "never actually populated by the backend"; no such column.
 *  - `isTeamTask` / team progress — the row has the columns, but only the *list* endpoint computes a
 *    `team` summary via `teamProgress()`; `GET /tasks/:id` does not, and the web detail page never reads
 *    them either. A team task here is just a task with >1 assignment, which renders correctly because
 *    every assignment is mapped, not just the first — that and evidence URLs are the two easy ways to
 *    get this port wrong.
 *
 * No live updates: mobile has no socket client (the web thread listens for `task:comment`), so a
 * co-parent's comment posted while this screen is open will not appear until it is reopened.
 */
import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssignmentStatus, TaskComment } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Chip, type ChipVariant } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { GradientHeader } from '@/components/GradientHeader';
import type { IoniconName } from '@/components/IconTile';
import { InfoRow } from '@/components/InfoRow';
import { PhotoViewer } from '@/components/PhotoViewer';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { asDate, dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import {
  archiveTask,
  fetchComments,
  fetchTask,
  INVALIDATED_BY_PARENT_WRITE,
  INVALIDATED_BY_RESET,
  postComment,
  resetAssignment,
  restoreTask,
  type TaskDetail,
} from '@/lib/parentWriteApi';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

type Assignment = TaskDetail['assignments'][number];

const STATUS_LABELS: Record<AssignmentStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  approved: 'Approved',
  rejected: 'Rejected',
  // The backend's own `GET /tasks/:id` query excludes 'expired' assignments (see the `where` clause in
  // backend/src/routes/tasks.ts), so this never actually renders — kept only so the map stays exhaustive
  // over `AssignmentStatus` rather than relying on that exclusion never changing.
  expired: 'Expired',
};

/**
 * Matches the web's colour meaning (green approved, amber waiting, red sent back) as a pill with the
 * status in words, so the state never depends on telling the colours apart.
 */
const STATUS_CHIP: Record<AssignmentStatus, { variant: ChipVariant; icon: IoniconName }> = {
  pending: { variant: 'info', icon: 'ellipse-outline' },
  in_progress: { variant: 'info', icon: 'play' },
  completed: { variant: 'pending', icon: 'hourglass' },
  approved: { variant: 'done', icon: 'checkmark-circle' },
  rejected: { variant: 'late', icon: 'arrow-undo' },
  expired: { variant: 'late', icon: 'time' },
};

const DIFFICULTY_LABEL: Record<string, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** "8 Aug at 3:45 PM" — used for completedAt/approvedAt, which are timestamps, not just dates. */
function formatDateTime(value: Date | string | null | undefined): string | null {
  const at = asDate(value);
  if (!at) return null;
  return `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// ── Comment thread ───────────────────────────────────────────────────────────

/**
 * Read + post, no socket. Loads once per mount, same as the web's `TaskCommentThread` before its
 * live-update effect — the honest subset of that component mobile's infra can support today.
 */
function CommentThread({ assignmentId }: { assignmentId: string }) {
  const theme = useTheme();
  const me = useAuth((state) => state.user?.id);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchComments(assignmentId);
      setComments(res.comments);
    } catch {
      // A 403/404 just means nothing to show here — same as the web, stay quiet rather than alarm a
      // parent about a thread that simply does not apply to them.
    } finally {
      setLoading(false);
    }
  }, [assignmentId]);

  useEffect(() => {
    load();
  }, [load]);

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await postComment(assignmentId, content);
      setComments((prev) => (prev.some((c) => c.id === res.comment.id) ? prev : [...prev, res.comment]));
      setDraft('');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSending(false);
    }
  }, [assignmentId, draft, sending]);

  return (
    <View style={styles.commentBox}>
      <AppText style={[styles.commentHeading, { color: theme.mutedForeground }]}>Comments</AppText>

      {loading ? (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Loading…</AppText>
      ) : comments.length === 0 ? (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>No comments yet.</AppText>
      ) : (
        comments.map((c) => {
          // Your own messages sit on the right in teal, everyone else's on the left, so a thread reads
          // as a conversation rather than a log.
          const mine = c.authorId === me;
          return (
            <View
              key={c.id}
              style={[
                styles.bubble,
                mine ? styles.bubbleMine : styles.bubbleTheirs,
                mine
                  ? { backgroundColor: theme.card, borderColor: theme.primary, borderWidth: 1 }
                  : { backgroundColor: theme.muted },
              ]}
            >
              <AppText style={[styles.commentAuthor, { color: theme.mutedForeground }]}>
                {c.author ? `${c.author.firstName} ${c.author.lastName}`.trim() : 'Someone'}
              </AppText>
              <AppText style={[styles.meta, { color: theme.cardForeground }]}>{c.content}</AppText>
            </View>
          );
        })
      )}

      {error !== null && (
        <Callout kind="danger" live>
          {error}
        </Callout>
      )}

      <View style={styles.commentComposer}>
        <View style={styles.commentField}>
          <Field
            label="Add a comment"
            value={draft}
            onChangeText={(text) => setDraft(text.slice(0, 1000))}
            editable={!sending}
          />
        </View>
        <Button label="Send" onPress={() => void send()} busy={sending} disabled={!draft.trim()} />
      </View>
    </View>
  );
}

// ── Assignment card ───────────────────────────────────────────────────────────

function AssignmentCard({
  assignment,
  resetting,
  onReset,
  setViewingPhoto,
}: {
  assignment: Assignment;
  resetting: boolean;
  onReset: (assignmentId: string) => void;
  setViewingPhoto: (uri: string) => void;
}) {
  const theme = useTheme();
  const canReset = ['completed', 'approved', 'rejected'].includes(assignment.status);
  const photos = (assignment.evidence ?? []).filter((e) => e.evidenceType === 'photo' && e.fileUrl);
  const notes = (assignment.evidence ?? []).filter((e) => e.evidenceType === 'note' && e.note);
  const completed = formatDateTime(assignment.completedAt);
  const approved = formatDateTime(assignment.approvedAt);

  const chip = STATUS_CHIP[assignment.status];

  return (
    <Card>
      <View style={styles.assignmentHeader}>
        <Avatar seed={assignment.child.id} name={assignment.child.firstName} size={40} />
        <View style={styles.assignmentChild}>
          <AppText style={[styles.childName, { color: theme.cardForeground }]}>
            {assignment.child.firstName} {assignment.child.lastName}
          </AppText>
          {completed && (
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Completed {completed}</AppText>
          )}
        </View>
        <Chip compact variant={chip.variant} icon={chip.icon} label={STATUS_LABELS[assignment.status]} />
      </View>

      {approved && (
        <View style={styles.chipRow}>
          <Chip compact variant="done" icon="checkmark-circle" label={`Approved ${approved}`} />
          {assignment.pointsAwarded != null ? (
            <Chip compact variant="gold" icon="star" label={`+${assignment.pointsAwarded} pts`} />
          ) : null}
        </View>
      )}
      {assignment.status === 'rejected' && assignment.rejectionReason && (
        <View style={styles.inline}>
          <Callout kind="danger" icon="arrow-undo" title="Sent back">
            {assignment.rejectionReason}
          </Callout>
        </View>
      )}

      {canReset && (
        <View style={styles.resetRow}>
          <Button
            label="Restore"
            variant="soft"
            onPress={() => onReset(assignment.id)}
            busy={resetting}
            disabled={resetting}
          />
        </View>
      )}

      {photos.length > 0 && (
        <View style={styles.evidenceSection}>
          <AppText style={[styles.commentHeading, { color: theme.mutedForeground }]}>
            Photo evidence
          </AppText>
          <View style={styles.photoRow}>
            {photos.map((photo) => (
              <Pressable
                key={photo.id}
                // Opens the FULL image, not the thumbnail that is on screen. Enlarging a thumbnail
                // would give a parent a bigger blurry crop and nothing more.
                onPress={() => setViewingPhoto((photo.fileUrl || photo.thumbnailUrl) as string)}
                accessibilityRole="imagebutton"
                accessibilityLabel="Open photo submitted as evidence"
                accessibilityHint="Shows the photo full screen"
              >
                <Image
                  // Presigned server-side and short-lived (private R2 bucket, see withEvidenceUrlsList in
                  // backend/src/routes/tasks.ts). Used exactly as received — never build a URL from an
                  // object key or cache one past this render; see approvals.tsx for the same rule.
                  source={{ uri: (photo.thumbnailUrl || photo.fileUrl) as string }}
                  style={[styles.photo, { backgroundColor: theme.muted }]}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {notes.length > 0 && (
        <View style={styles.evidenceSection}>
          <AppText style={[styles.commentHeading, { color: theme.mutedForeground }]}>Notes</AppText>
          {notes.map((note) => (
            <View key={note.id} style={[styles.quote, { backgroundColor: theme.muted }]}>
              <AppText style={[styles.noteText, { color: theme.cardForeground }]}>&ldquo;{note.note}&rdquo;</AppText>
            </View>
          ))}
        </View>
      )}

      <CommentThread assignmentId={assignment.id} />
    </Card>
  );
}

// ── Problem state (missing id / load failure) ────────────────────────────────

function ProblemState({ message }: { message: string }) {
  return (
    <Screen>
      <Callout kind="warning" title="This task could not be opened">
        {message}
      </Callout>
      <Button label="Back to tasks" onPress={() => router.replace('/(parent)/tasks')} />
    </Screen>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TaskDetailScreen() {
  /** The presigned URL currently shown full screen, or null. */
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const theme = useTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string }>();
  // A stale or missing id (a bad deep link, a param lost across a reload) must land here rather than
  // crash on `.assignments` of `undefined` — hence checked before the query is even built.
  const id = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;

  const detail = useQuery({
    queryKey: ['tasks', 'detail', id ?? ''] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchTask(id as string, signal),
    enabled: id !== null,
  });

  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const resetMutation = useMutation({
    mutationFn: resetAssignment,
    onSuccess: async () => {
      setResetError(null);
      // The reset assignment's own detail must refetch (status/points just cleared), and the same
      // reset can also pull a `completed` row out of the approvals queue and change what the
      // dashboard/list show for this task — see the note on INVALIDATED_BY_RESET.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', 'detail', id ?? ''] }),
        ...INVALIDATED_BY_RESET.map((key) =>
          queryClient.invalidateQueries({ queryKey: key as unknown as string[] })
        ),
      ]);
    },
    onError: (err) => setResetError(describeError(err)),
    onSettled: () => setResettingId(null),
  });

  const handleReset = useCallback(
    (assignmentId: string) => {
      setResettingId(assignmentId);
      resetMutation.mutate(assignmentId);
    },
    [resetMutation]
  );

  /**
   * Archive and restore, the same pair the list offers by swipe.
   *
   * Here as an ordinary button because a swipe is invisible to a screen reader and undiscoverable
   * without being told, and because this is the screen a parent is on when they decide a task is
   * finished with. It replaces nothing: the edit form's old "Delete task" button called
   * `DELETE /tasks/:id`, which is a soft delete with no route back in either app.
   */
  const [statusBusy, setStatusBusy] = useState(false);

  const statusMutation = useMutation({
    mutationFn: ({ taskId, archived }: { taskId: string; archived: boolean }) =>
      archived ? restoreTask(taskId) : archiveTask(taskId),
    onSuccess: async () => {
      setResetError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', 'detail', id ?? ''] }),
        ...INVALIDATED_BY_PARENT_WRITE.map((key) =>
          queryClient.invalidateQueries({ queryKey: key as readonly unknown[] })
        ),
      ]);
    },
    onError: (err) => setResetError(describeError(err)),
    onSettled: () => setStatusBusy(false),
  });

  if (id === null) {
    return <ProblemState message="We couldn't tell which task to open. Go back and try again." />;
  }

  if (detail.isPending) {
    return (
      <Screen center>
        <ActivityIndicator color={theme.primary} />
      </Screen>
    );
  }

  if (detail.isError) {
    return <ProblemState message={describeError(detail.error)} />;
  }

  const task = detail.data.task;
  const active = task.assignments.filter((a) => ['pending', 'in_progress'].includes(a.status));
  const resolved = task.assignments.filter((a) =>
    ['completed', 'approved', 'rejected'].includes(a.status)
  );
  const due = dueLabel(task.dueDate);
  const overdue = isOverdue(task.dueDate) && task.status === 'active';

  return (
    <Screen scroll>
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back to tasks"
        style={styles.backRow}
      >
        <AppText style={[styles.backLabel, { color: theme.mutedForeground }]}>‹ Back to Tasks</AppText>
      </Pressable>

      <GradientHeader
        tone="teal"
        icon="checkbox"
        eyebrow={[
          task.taskTag === 'primary' ? 'Must do' : 'Bonus',
          task.difficulty ? DIFFICULTY_LABEL[task.difficulty] ?? task.difficulty : null,
          task.status !== 'active' ? (task.status === 'archived' ? 'Archived' : 'Paused') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        title={task.title}
        subtitle={task.description ?? undefined}
      />

      <View style={styles.headerActions}>
        <View style={styles.grow}>
          <Button
            label="Edit"
            variant="soft"
            onPress={() => router.push({ pathname: '/(parent)/task-form', params: { id } })}
          />
        </View>
        <View style={styles.grow}>
          <Button
            label={task.status === 'archived' ? 'Restore' : 'Archive'}
            variant={task.status === 'archived' ? 'soft' : 'softDanger'}
            busy={statusBusy}
            disabled={statusBusy}
            onPress={() => {
              setStatusBusy(true);
              statusMutation.mutate({ taskId: id, archived: task.status === 'archived' });
            }}
          />
        </View>
      </View>

      <Card>
        <InfoRow icon="star" tone="gold" label="Worth" value={`${task.pointsValue} points`} />
        {due !== null && (
          // Overdue is worded by `dueLabel` ("2 days overdue") as well as coloured.
          <InfoRow icon="calendar" tone="primary" label="Due" value={due} alert={overdue} />
        )}
        {task.estimatedMinutes != null && (
          <InfoRow icon="time" tone="xp" label="Takes" value={`${task.estimatedMinutes} min`} />
        )}
        {task.category && <InfoRow icon="pricetag" tone="peach" label="Category" value={task.category} />}
        <InfoRow
          icon="camera"
          tone="peach"
          label="Photo"
          value={task.requiresPhotoEvidence ? 'Required' : 'Not needed'}
        />
        {task.isRecurring && (
          <InfoRow
            icon="repeat"
            tone="success"
            label="Repeats"
            value={task.recurrencePattern ? task.recurrencePattern.charAt(0).toUpperCase() + task.recurrencePattern.slice(1) : 'Yes'}
          />
        )}
        {task.maxClaimsTotal != null && (
          <InfoRow icon="people" tone="xp" label="Claim limit" value={`${task.maxClaimsTotal} children`} />
        )}
        {task.creator && (
          <InfoRow
            icon="person"
            tone="primary"
            label="Created by"
            value={`${task.creator.firstName} ${task.creator.lastName}`}
          />
        )}
      </Card>

      {resetError !== null && (
        <Callout kind="danger" live>
          {resetError}
        </Callout>
      )}

      {active.length > 0 && (
        <View style={styles.section}>
          <SectionTitle title="Active assignments" icon="hourglass" tone="warning" />
          {active.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              resetting={resettingId === a.id}
              onReset={handleReset}
              setViewingPhoto={setViewingPhoto}
            />
          ))}
        </View>
      )}

      {resolved.length > 0 && (
        <View style={styles.section}>
          <SectionTitle title="Completed assignments" icon="checkmark-circle" tone="success" />
          {resolved.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              resetting={resettingId === a.id}
              onReset={handleReset}
              setViewingPhoto={setViewingPhoto}
            />
          ))}
        </View>
      )}

      {task.assignments.length === 0 && (
        <EmptyState emoji="🧒" title="No assignments yet." message="Edit the task to assign children." />
      )}
      <PhotoViewer uri={viewingPhoto} onClose={() => setViewingPhoto(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { minHeight: minTouchTarget, justifyContent: 'center', marginBottom: spacing[2] },
  backLabel: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  grow: { flex: 1 },
  headerActions: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  section: { marginTop: spacing[1] },
  assignmentHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  assignmentChild: { flex: 1 },
  childName: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.semibold },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[3] },
  inline: { marginTop: spacing[3], marginBottom: -spacing[4] },
  resetRow: { marginTop: spacing[3], alignSelf: 'flex-start' },
  evidenceSection: { marginTop: spacing[4] },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  photo: { width: 120, height: 120, borderRadius: radius.lg },
  quote: { borderRadius: radius.lg, padding: spacing[3], marginTop: spacing[1] },
  noteText: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, fontStyle: 'italic' },
  commentBox: { marginTop: spacing[4], paddingTop: spacing[3] },
  commentHeading: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight, fontWeight: fontWeight.bold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing[2] },
  bubble: { borderRadius: radius.lg, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginBottom: spacing[2], maxWidth: '88%' },
  bubbleTheirs: { alignSelf: 'flex-start', borderBottomLeftRadius: spacing[1] },
  bubbleMine: { alignSelf: 'flex-end', borderBottomRightRadius: spacing[1] },
  commentAuthor: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight, fontWeight: fontWeight.bold },
  commentComposer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2], marginTop: spacing[2] },
  commentField: { flex: 1 },
});
