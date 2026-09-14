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
import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Field } from '@/components/Field';
import { GradientHeader } from '@/components/GradientHeader';
import { PhotoViewer } from '@/components/PhotoViewer';
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
import { noteApprovalGranted } from '@/lib/reviewPrompt';
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

function EvidenceBlock({
  evidence,
  onOpenPhoto,
}: {
  evidence: PendingApproval['evidence'];
  onOpenPhoto: (uri: string) => void;
}) {
  const theme = useTheme();
  if (evidence.length === 0) return null;

  const photos = evidence.filter((e) => e.evidenceType === 'photo' && e.fileUrl);
  const notes = evidence.filter((e) => e.evidenceType === 'note' && e.note);

  return (
    <View style={styles.evidence}>
      {/* Full width rather than the old 96dp thumbnail: judging whether a room is tidy from a stamp-sized
          picture is the decision this screen exists for. Tapping still opens the full-screen viewer. */}
      {photos.map((photo) => (
        <Pressable
          key={photo.id}
          onPress={() => onOpenPhoto(photo.fileUrl as string)}
          accessibilityRole="imagebutton"
          accessibilityLabel="Open photo submitted as evidence"
          accessibilityHint="Shows the photo full screen"
        >
          {/* Presigned and short-lived, never persisted anywhere. See approvalsApi.ts. */}
          <Image
            source={{ uri: photo.fileUrl as string }}
            style={[styles.photo, { backgroundColor: theme.muted }]}
            resizeMode="cover"
          />
        </Pressable>
      ))}
      {notes.map((note) => (
        <View key={note.id} style={[styles.quote, { backgroundColor: theme.muted }]}>
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={16}
            color={theme.mutedForeground}
            importantForAccessibility="no"
            accessibilityElementsHidden
          />
          <AppText style={[styles.note, { color: theme.cardForeground }]}>&ldquo;{note.note}&rdquo;</AppText>
        </View>
      ))}
    </View>
  );
}

function ApprovalRow({
  item,
  busy,
  onApprove,
  onReject,
  onOpenPhoto,
}: {
  item: PendingApproval;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onOpenPhoto: (uri: string) => void;
}) {
  const theme = useTheme();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const submitted = completedLabel(item.completedAt);

  const canReject = reason.trim().length > 0 && !busy;

  return (
    <Card>
      <View style={styles.childRow}>
        <Avatar seed={item.child.id} name={item.child.firstName} size={40} />
        <View style={styles.grow}>
          <AppText style={[styles.childName, { color: theme.cardForeground }]}>{item.child.firstName}</AppText>
          {submitted ? (
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>{submitted}</AppText>
          ) : null}
        </View>
        <Chip compact variant="gold" icon="star" label={`${item.task.pointsValue} pts`} />
      </View>

      <AppText style={[styles.taskTitle, { color: theme.cardForeground }]} numberOfLines={2}>
        {item.task.title}
      </AppText>

      {item.task.description ? (
        <AppText style={[styles.description, { color: theme.mutedForeground }]} numberOfLines={3}>
          {item.task.description}
        </AppText>
      ) : null}

      <EvidenceBlock evidence={item.evidence} onOpenPhoto={onOpenPhoto} />

      {/*
        A task that required a photo but has none is flagged rather than silently approvable: the
        parent should know that before deciding, not after.
      */}
      {item.task.requiresPhotoEvidence &&
        item.evidence.filter((e) => e.evidenceType === 'photo').length === 0 && (
          <View style={styles.inlineCallout}>
            <Callout kind="warning" icon="camera-outline">
              This task asked for a photo, but none was attached.
            </Callout>
          </View>
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
            {/* Soft teal, not grey: sending back is a real decision, and a grey slab read as disabled. */}
            <Button label="Send back" variant="soft" onPress={() => setRejecting(true)} disabled={busy} />
          </View>
        </View>
      )}
    </Card>
  );
}

/** Confirmation of what an approval actually did: points, level, streak. */
function ResultBanner({ result, onDismiss }: { result: ApprovalResult; onDismiss: () => void }) {
  const parts: string[] = [];
  if (result.pointsAwarded) parts.push(`+${result.pointsAwarded} points`);
  if (result.newLevel) parts.push(`level ${result.newLevel}`);
  if (result.streakUpdated?.currentStreak) {
    parts.push(
      result.streakUpdated.isNewRecord
        ? `${result.streakUpdated.currentStreak}-day streak, a new record`
        : `${result.streakUpdated.currentStreak}-day streak`
    );
  }
  const unlocked = result.achievementsUnlocked?.length ?? 0;
  if (unlocked > 0) parts.push(`${unlocked} achievement${unlocked === 1 ? '' : 's'} unlocked`);

  return (
    <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityHint="Dismisses this message">
      <Callout kind="success" icon="sparkles" title="Approved" live>
        {parts.length > 0 ? `${parts.join(', ')}. Tap to dismiss.` : 'Tap to dismiss.'}
      </Callout>
    </Pressable>
  );
}

export default function Approvals() {
  /** The presigned URL currently shown full screen, or null. */
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
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
      // A granted approval is the app's one reliably good moment: a child did the thing, and the
      // parent just said so. Rejections are excluded on purpose, and so is the seeded approval in
      // welcome.tsx, which is a demonstration rather than evidence the app works for this family.
      // Deliberately not awaited: the invalidations below are what the parent is waiting on, and a
      // rating prompt must never sit in front of the list refreshing. It cannot reject.
      if (variables.approved) void noteApprovalGranted();
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
        <GradientHeader tone="amber" icon="checkmark-done" eyebrow="Approvals" title="Approvals" />
        <Callout kind="danger" title={error instanceof NetworkError ? 'No connection' : 'Could not load approvals'} live>
          {describeError(error)}
        </Callout>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  const header = (
    <View>
      {/* Amber: the one screen where someone is waiting on you. */}
      <GradientHeader
        tone="amber"
        icon="checkmark-done"
        eyebrow="Approvals"
        title={
          isPending
            ? 'Loading…'
            : assignments.length === 0
              ? 'Nothing waiting'
              : `${assignments.length} waiting for you`
        }
      />

      {lastResult && <ResultBanner result={lastResult} onDismiss={() => setLastResult(null)} />}

      {actionError !== null && (
        <Callout kind="danger" live>
          {actionError}
        </Callout>
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
            onOpenPhoto={setViewingPhoto}
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
            <EmptyState emoji="🎉" title="Nothing is waiting for approval." message="You're all caught up." />
          )
        }
      />
      <PhotoViewer uri={viewingPhoto} onClose={() => setViewingPhoto(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: spacing[6] },
  grow: { flex: 1 },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  childName: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.semibold },
  taskTitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    marginTop: spacing[3],
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  description: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  evidence: { marginTop: spacing[3], gap: spacing[2] },
  // 4:3 rather than square: the child's picker does not crop, so a square frame would chop the photo.
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg },
  quote: { flexDirection: 'row', gap: spacing[2], borderRadius: radius.lg, padding: spacing[3] },
  note: { flex: 1, fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, fontStyle: 'italic' },
  inlineCallout: { marginTop: spacing[3], marginBottom: -spacing[4] },
  rejectBox: { marginTop: spacing[4] },
  buttonRow: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[4] },
  buttonHalf: { flex: 1 },
  centred: { paddingVertical: spacing[6], alignItems: 'center' },
});
