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
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { asDate, dueLabel, isOverdue } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import {
  fetchComments,
  fetchTask,
  INVALIDATED_BY_RESET,
  postComment,
  resetAssignment,
  type TaskDetail,
} from '@/lib/parentWriteApi';
import { fontSize, fontWeight, minTouchTarget, palette, radius, spacing, type SemanticTheme, useTheme } from '@/theme';

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

/** Matches the web's colour meaning (green/amber/red) via the shared token ramps, not hex literals. */
function statusColor(theme: SemanticTheme, status: AssignmentStatus): string {
  switch (status) {
    case 'approved':
      return palette.success[600];
    case 'completed':
      return palette.warning[600];
    case 'rejected':
      return theme.destructive;
    case 'in_progress':
      return theme.primary;
    default:
      return theme.mutedForeground;
  }
}

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
        comments.map((c) => (
          <View key={c.id} style={styles.commentRow}>
            <AppText style={[styles.commentAuthor, { color: theme.cardForeground }]}>
              {c.author ? `${c.author.firstName} ${c.author.lastName}`.trim() : 'Someone'}
            </AppText>
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>{c.content}</AppText>
          </View>
        ))
      )}

      {error !== null && (
        <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
          {error}
        </AppText>
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
}: {
  assignment: Assignment;
  resetting: boolean;
  onReset: (assignmentId: string) => void;
}) {
  const theme = useTheme();
  const canReset = ['completed', 'approved', 'rejected'].includes(assignment.status);
  const photos = (assignment.evidence ?? []).filter((e) => e.evidenceType === 'photo' && e.fileUrl);
  const notes = (assignment.evidence ?? []).filter((e) => e.evidenceType === 'note' && e.note);
  const completed = formatDateTime(assignment.completedAt);
  const approved = formatDateTime(assignment.approvedAt);

  return (
    <Card>
      <View style={styles.assignmentHeader}>
        <View style={styles.assignmentChild}>
          <AppText style={[styles.childName, { color: theme.cardForeground }]}>
            {assignment.child.firstName} {assignment.child.lastName}
          </AppText>
          <AppText style={[styles.statusBadge, { color: statusColor(theme, assignment.status) }]}>
            {STATUS_LABELS[assignment.status]}
          </AppText>
        </View>

        {canReset && (
          <Button
            label="Restore"
            variant="secondary"
            onPress={() => onReset(assignment.id)}
            busy={resetting}
            disabled={resetting}
          />
        )}
      </View>

      {completed && (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Completed {completed}</AppText>
      )}
      {approved && (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
          Approved {approved}
          {assignment.pointsAwarded != null ? ` · +${assignment.pointsAwarded} pts` : ''}
        </AppText>
      )}
      {assignment.status === 'rejected' && assignment.rejectionReason && (
        <AppText style={[styles.meta, { color: theme.destructive }]}>
          Rejected: {assignment.rejectionReason}
        </AppText>
      )}

      {photos.length > 0 && (
        <View style={styles.evidenceSection}>
          <AppText style={[styles.commentHeading, { color: theme.mutedForeground }]}>
            Photo evidence
          </AppText>
          <View style={styles.photoRow}>
            {photos.map((photo) => (
              <Image
                key={photo.id}
                // Presigned server-side and short-lived (private R2 bucket, see withEvidenceUrlsList in
                // backend/src/routes/tasks.ts). Used exactly as received — never build a URL from an
                // object key or cache one past this render; see approvals.tsx for the same rule.
                source={{ uri: (photo.thumbnailUrl || photo.fileUrl) as string }}
                style={[styles.photo, { borderColor: theme.border }]}
                resizeMode="cover"
                accessibilityLabel="Photo submitted as evidence"
              />
            ))}
          </View>
        </View>
      )}

      {notes.length > 0 && (
        <View style={styles.evidenceSection}>
          <AppText style={[styles.commentHeading, { color: theme.mutedForeground }]}>Notes</AppText>
          {notes.map((note) => (
            <AppText key={note.id} style={[styles.noteText, { color: theme.cardForeground }]}>
              &ldquo;{note.note}&rdquo;
            </AppText>
          ))}
        </View>
      )}

      <CommentThread assignmentId={assignment.id} />
    </Card>
  );
}

// ── Problem state (missing id / load failure) ────────────────────────────────

function ProblemState({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <Screen>
      <Card>
        <AppText style={[styles.meta, { color: theme.cardForeground }]}>{message}</AppText>
      </Card>
      <Button label="Back to tasks" onPress={() => router.replace('/(parent)/tasks')} />
    </Screen>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TaskDetailScreen() {
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

      <Card>
        <View style={styles.headerTop}>
          <View style={styles.headerTitleBlock}>
            <View style={styles.badgeRow}>
              <AppText style={[styles.badge, { color: theme.mutedForeground }]}>{task.difficulty}</AppText>
              <AppText style={[styles.badge, { color: theme.mutedForeground }]}>
                {task.taskTag === 'primary' ? 'Primary' : 'Secondary'}
              </AppText>
              {task.status !== 'active' && (
                <AppText style={[styles.badge, { color: theme.mutedForeground }]}>{task.status}</AppText>
              )}
            </View>
            <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
              {task.title}
            </AppText>
            {task.description && (
              <AppText style={[styles.description, { color: theme.mutedForeground }]}>
                {task.description}
              </AppText>
            )}
          </View>

          <Button
            label="Edit"
            variant="secondary"
            onPress={() => router.push({ pathname: '/(parent)/task-form', params: { id } })}
          />
        </View>

        <View style={styles.metaList}>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>
            {task.pointsValue} points
          </AppText>
          {due !== null && (
            <AppText style={[styles.meta, { color: overdue ? theme.destructive : theme.cardForeground }]}>
              Due {due}
            </AppText>
          )}
          {task.estimatedMinutes != null && (
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>
              {task.estimatedMinutes} min
            </AppText>
          )}
          {task.category && (
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>{task.category}</AppText>
          )}
          {task.requiresPhotoEvidence && (
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>Photo required</AppText>
          )}
          {task.isRecurring && (
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>
              Recurring{task.recurrencePattern ? ` · ${task.recurrencePattern}` : ''}
            </AppText>
          )}
          {task.maxClaimsTotal != null && (
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>
              Max {task.maxClaimsTotal} claims
            </AppText>
          )}
          {task.creator && (
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
              Created by {task.creator.firstName} {task.creator.lastName}
            </AppText>
          )}
        </View>
      </Card>

      {resetError !== null && (
        <Card style={{ borderColor: theme.destructive }}>
          <AppText accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
            {resetError}
          </AppText>
        </Card>
      )}

      {active.length > 0 && (
        <View style={styles.section}>
          <AppText style={[styles.sectionTitle, { color: theme.foreground }]}>
            Active assignments
          </AppText>
          {active.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              resetting={resettingId === a.id}
              onReset={handleReset}
            />
          ))}
        </View>
      )}

      {resolved.length > 0 && (
        <View style={styles.section}>
          <AppText style={[styles.sectionTitle, { color: theme.foreground }]}>
            Completed assignments
          </AppText>
          {resolved.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              resetting={resettingId === a.id}
              onReset={handleReset}
            />
          ))}
        </View>
      )}

      {task.assignments.length === 0 && (
        <Card>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
            No assignments yet. Edit the task to assign children.
          </AppText>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { minHeight: minTouchTarget, justifyContent: 'center', marginBottom: spacing[2] },
  backLabel: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing[3] },
  headerTitleBlock: { flex: 1 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], marginBottom: spacing[1] },
  badge: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight, textTransform: 'capitalize', fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl.fontSize, lineHeight: fontSize.xl.lineHeight, fontWeight: fontWeight.bold },
  description: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[2] },
  metaList: { marginTop: spacing[4], gap: spacing[2] },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  section: { marginTop: spacing[2] },
  sectionTitle: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.semibold, marginBottom: spacing[3] },
  assignmentHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing[3], marginBottom: spacing[2] },
  assignmentChild: { flex: 1 },
  childName: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.semibold },
  statusBadge: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight, fontWeight: fontWeight.medium, marginTop: spacing[1] },
  evidenceSection: { marginTop: spacing[3] },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  photo: { width: 88, height: 88, borderRadius: radius.md, borderWidth: 1 },
  noteText: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, fontStyle: 'italic', marginTop: spacing[1] },
  commentBox: { marginTop: spacing[4], paddingTop: spacing[3] },
  commentHeading: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight, fontWeight: fontWeight.bold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing[2] },
  commentRow: { marginBottom: spacing[2] },
  commentAuthor: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, fontWeight: fontWeight.semibold },
  commentComposer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2], marginTop: spacing[2] },
  commentField: { flex: 1 },
});
