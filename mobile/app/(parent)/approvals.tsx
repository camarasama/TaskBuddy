/**
 * Approval queue — the first screen that writes.
 *
 * Two things here are deliberate and worth not "simplifying" later.
 *
 * **No optimistic update.** Approving moves points, XP, possibly a level and a streak, and the server
 * is the only thing that knows the resulting numbers. Removing the row optimistically and then having
 * the request fail would mean a parent believes they approved something they did not — and the child
 * is still waiting. The row stays, disabled, until the server confirms.
 *
 * **Rejection requires a reason to be typed, not just tapped.** The reason is shown to a child. A
 * one-tap reject with no explanation is the interaction most likely to cause a bad evening in a real
 * family, so it costs a sentence.
 */
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import {
  approvalsQuery,
  decideApproval,
  INVALIDATED_BY_APPROVAL,
  type ApprovalResult,
  type PendingApproval,
} from '@/lib/approvalsApi';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

const REASON_MAX = 500;

function completedLabel(value: Date | string | null | undefined): string | null {
  const at = asDate(value);
  if (!at) return null;
  return `Submitted ${at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })} at ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function EvidenceBlock({ evidence }: { evidence: PendingApproval['evidence'] }) {
  const theme = useTheme();
  if (evidence.length === 0) return null;

  const photos = evidence.filter((e) => e.evidenceType === 'photo' && e.fileUrl);
  const notes = evidence.filter((e) => e.evidenceType === 'note' && e.note);

  return (
    <View style={styles.evidence}>
      {photos.length > 0 && (
        <View style={styles.photoRow}>
          {photos.map((photo) => (
            <Image
              key={photo.id}
              // Presigned and short-lived — never persisted anywhere. See approvalsApi.ts.
              source={{ uri: photo.fileUrl as string }}
              style={[styles.photo, { borderColor: theme.border }]}
              resizeMode="cover"
              accessibilityLabel="Photo submitted as evidence"
            />
          ))}
        </View>
      )}
      {notes.map((note) => (
        <Text key={note.id} style={[styles.note, { color: theme.cardForeground }]}>
          &ldquo;{note.note}&rdquo;
        </Text>
      ))}
    </View>
  );
}

function ApprovalRow({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: PendingApproval;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const theme = useTheme();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const submitted = completedLabel(item.completedAt);

  const canReject = reason.trim().length > 0 && !busy;

  return (
    <Card>
      <View style={styles.rowHeader}>
        <Text style={[styles.taskTitle, { color: theme.cardForeground }]} numberOfLines={2}>
          {item.task.title}
        </Text>
        <Text style={[styles.points, { color: theme.foreground }]}>{item.task.pointsValue} pts</Text>
      </View>

      <Text style={[styles.meta, { color: theme.mutedForeground }]}>
        {item.child.firstName}
        {submitted ? ` · ${submitted}` : ''}
      </Text>

      {item.task.description ? (
        <Text style={[styles.description, { color: theme.mutedForeground }]} numberOfLines={3}>
          {item.task.description}
        </Text>
      ) : null}

      <EvidenceBlock evidence={item.evidence} />

      {/*
        A task that required a photo but has none is flagged rather than silently approvable — the
        parent should know that before deciding, not after.
      */}
      {item.task.requiresPhotoEvidence &&
        item.evidence.filter((e) => e.evidenceType === 'photo').length === 0 && (
          <Text style={[styles.warning, { color: theme.destructive }]}>
            This task asked for a photo, but none was attached.
          </Text>
        )}

      {rejecting ? (
        <View style={styles.rejectBox}>
          <Field
            label="Why is this being sent back?"
            value={reason}
            onChangeText={setReason}
            multiline
            maxLength={REASON_MAX}
            editable={!busy}
            hint={`${item.child.firstName} will see this. ${REASON_MAX - reason.length} characters left.`}
          />
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <Button
                label="Send back"
                onPress={() => onReject(reason.trim())}
                busy={busy}
                disabled={!canReject}
              />
            </View>
            <View style={styles.buttonHalf}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => {
                  setRejecting(false);
                  setReason('');
                }}
                disabled={busy}
              />
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.buttonRow}>
          <View style={styles.buttonHalf}>
            <Button label="Approve" onPress={onApprove} busy={busy} disabled={busy} />
          </View>
          <View style={styles.buttonHalf}>
            <Button
              label="Send back"
              variant="secondary"
              onPress={() => setRejecting(true)}
              disabled={busy}
            />
          </View>
        </View>
      )}
    </Card>
  );
}

/** Confirmation of what an approval actually did — points, level, streak. */
function ResultBanner({ result, onDismiss }: { result: ApprovalResult; onDismiss: () => void }) {
  const theme = useTheme();

  const parts: string[] = [];
  if (result.pointsAwarded) parts.push(`+${result.pointsAwarded} points`);
  if (result.newLevel) parts.push(`level ${result.newLevel}`);
  if (result.streakUpdated?.currentStreak) {
    parts.push(
      result.streakUpdated.isNewRecord
        ? `${result.streakUpdated.currentStreak}-day streak — a new record`
        : `${result.streakUpdated.currentStreak}-day streak`
    );
  }
  const unlocked = result.achievementsUnlocked?.length ?? 0;
  if (unlocked > 0) parts.push(`${unlocked} achievement${unlocked === 1 ? '' : 's'} unlocked`);

  return (
    <Pressable onPress={onDismiss} accessibilityRole="button">
      <Card style={{ borderColor: theme.primary, borderWidth: 2 }}>
        <Text accessibilityRole="alert" style={[styles.resultText, { color: theme.cardForeground }]}>
          Approved{parts.length > 0 ? ` — ${parts.join(', ')}` : ''}.
        </Text>
        <Text style={[styles.meta, { color: theme.mutedForeground }]}>Tap to dismiss</Text>
      </Card>
    </Pressable>
  );
}

export default function Approvals() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const { data, error, isPending, isError, refetch, isRefetching } = useQuery(approvalsQuery());

  /** Which row is mid-request, so only that row's buttons disable rather than the whole list. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ApprovalResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: decideApproval,
    onSuccess: async (result, variables) => {
      setActionError(null);
      // Only surface the numbers for an approval; a rejection awards nothing.
      setLastResult(variables.approved ? result : null);
      // Approving moves points and the dashboard's pending count, so invalidate more than this list.
      await Promise.all(
        INVALIDATED_BY_APPROVAL.map((key) =>
          queryClient.invalidateQueries({ queryKey: key as unknown as string[] })
        )
      );
    },
    onError: (caught) => setActionError(describeError(caught)),
    onSettled: () => setPendingId(null),
  });

  const decide = useCallback(
    (assignmentId: string, approved: boolean, rejectionReason?: string) => {
      setPendingId(assignmentId);
      mutation.mutate({ assignmentId, approved, rejectionReason });
    },
    [mutation]
  );

  const assignments = useMemo(() => data?.assignments ?? [], [data]);

  if (isError) {
    return (
      <Screen>
        <Text style={[styles.title, { color: theme.foreground }]}>Approvals</Text>
        <Card>
          <Text style={[styles.cardTitle, { color: theme.destructive }]}>
            {error instanceof NetworkError ? 'No connection' : 'Could not load approvals'}
          </Text>
          <Text style={[styles.meta, { color: theme.cardForeground }]}>{describeError(error)}</Text>
        </Card>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  const header = (
    <View>
      <Text style={[styles.title, { color: theme.foreground }]}>Approvals</Text>
      <Text style={[styles.subtitle, { color: theme.mutedForeground }]}>
        {isPending
          ? 'Loading…'
          : assignments.length === 0
            ? 'Nothing waiting'
            : `${assignments.length} waiting for you`}
      </Text>

      {lastResult && <ResultBanner result={lastResult} onDismiss={() => setLastResult(null)} />}

      {actionError !== null && (
        <Card style={{ borderColor: theme.destructive }}>
          <Text accessibilityRole="alert" style={[styles.meta, { color: theme.destructive }]}>
            {actionError}
          </Text>
        </Card>
      )}
    </View>
  );

  return (
    <Screen>
      <FlatList
        data={assignments}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ApprovalRow
            item={item}
            busy={pendingId === item.id}
            onApprove={() => decide(item.id, true)}
            onReject={(reason) => decide(item.id, false, reason)}
          />
        )}
        ListHeaderComponent={header}
        refreshing={isRefetching}
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
                Nothing is waiting for approval. You&apos;re all caught up.
              </Text>
            </Card>
          )
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
  description: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[2],
  },
  evidence: { marginTop: spacing[3] },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  photo: { width: 96, height: 96, borderRadius: radius.md, borderWidth: 1 },
  note: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontStyle: 'italic',
    marginTop: spacing[2],
  },
  warning: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.medium,
    marginTop: spacing[3],
  },
  rejectBox: { marginTop: spacing[4] },
  buttonRow: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[4] },
  buttonHalf: { flex: 1 },
  resultText: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[1],
  },
  centred: { paddingVertical: spacing[6], alignItems: 'center' },
});
