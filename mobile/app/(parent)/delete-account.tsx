/**
 * Delete the family account, from inside the app.
 *
 * ## Why this screen exists rather than a link to the website
 *
 * Settings used to send a parent to gettaskbuddy.com/delete-account, which explained that deletion
 * was done by emailing privacy@. Google Play's data-deletion policy expects an account holder to be
 * able to start deletion **in the app**, and an outbound link to instructions is not that. The web
 * page stays, because the policy also expects a route for someone who has uninstalled the app.
 *
 * ## Two gates, doing two different jobs
 *
 * The typed word proves the tap was deliberate. The password proves it was the account holder. A
 * borrowed, unlocked phone defeats exactly one of those, which is why both are here and why the
 * server re-checks both: this screen is a convenience, never the enforcement.
 *
 * ## Nothing is destroyed here
 *
 * This sets a date. The erasure happens in the backend's retention sweep after the recovery window,
 * and until then every screen in the app keeps working for parents. That is deliberate: the parent
 * who changes their mind at 2am needs to be able to sign in and stop it. Children are locked out
 * immediately, which is the honest signal that the account is closing.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import Ionicons from '@expo/vector-icons/Ionicons';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { FormSection } from '@/components/FormSection';
import { GradientHeader } from '@/components/GradientHeader';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import {
  cancelDeletion,
  DELETION_KEY,
  deletionQuery,
  parentsQuery,
  scheduleDeletion,
  type DeletionStatus,
} from '@/lib/familyApi';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, palette, spacing, useTheme } from '@/theme';

/** Matches the server's check in `scheduleDeletionSchema`. Trimmed and case-insensitive. */
function confirmed(text: string): boolean {
  return text.trim().toUpperCase() === 'DELETE';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** The state a parent sees inside the recovery window: the date, and the way out. */
function Scheduled({
  status,
  canCancel,
  busy,
  onCancel,
}: {
  status: DeletionStatus;
  canCancel: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  const theme = useTheme();

  return (
    <Callout kind="warning" icon="alert-circle" title="Scheduled for deletion">
      <AppText style={[styles.body, { color: theme.cardForeground }]}>
        Everything in your family account will be permanently erased on{' '}
        <AppText style={[styles.emphasis, { color: theme.destructive }]}>
          {status.purgeAfter ? formatDate(status.purgeAfter) : 'the scheduled date'}
        </AppText>
        . That includes every child profile, every photo they uploaded, and all tasks, points and
        rewards.
      </AppText>
      <AppText style={[styles.detail, { color: theme.cardForeground }]}>
        Your children cannot sign in while this is scheduled. Nothing has been deleted yet, and
        cancelling puts everything back exactly as it was.
      </AppText>
      {canCancel ? (
        <View style={styles.action}>
          <Button label="Keep my account" onPress={onCancel} busy={busy} />
        </View>
      ) : (
        <AppText style={[styles.detail, styles.emphasis, { color: theme.cardForeground }]}>
          Only the primary parent can cancel this.
        </AppText>
      )}
    </Callout>
  );
}

/** What gets deleted, one line each, with a red cross so the list reads as losses rather than features. */
const DELETED = [
  'Every child profile, including photos they uploaded',
  'All tasks, points, streaks, achievements and rewards',
  'Your account and every co-parent account',
];

export default function DeleteAccount() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuth((state) => state.user);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const status = useQuery(deletionQuery());
  const parents = useQuery(parentsQuery());

  /**
   * Who may act. Undefined until the parents list arrives, and that third state matters: collapsing
   * it to `false` would flash "only the primary parent can do this" at the primary parent while the
   * query is still in flight, which reads as a refusal rather than as loading.
   */
  const isPrimary = parents.data
    ? (parents.data.parents.find((p) => p.id === me?.id)?.isPrimaryParent ?? false)
    : undefined;

  const settle = useCallback(
    async (next: DeletionStatus, message: string) => {
      queryClient.setQueryData(DELETION_KEY, next);
      // The whole app changes shape around this flag, so nothing cached survives it.
      await queryClient.invalidateQueries();
      toast.show(message, 'success');
    },
    [queryClient, toast]
  );

  const schedule = useMutation({
    mutationFn: () => scheduleDeletion({ password, confirm }),
    onSuccess: async (next) => {
      setPassword('');
      setConfirm('');
      await settle(next, 'Your account is scheduled for deletion. Check your email.');
    },
    onError: (error) => toast.show(describeError(error), 'error'),
  });

  const stop = useMutation({
    mutationFn: cancelDeletion,
    onSuccess: async (next) => {
      await settle(next, 'Your account will not be deleted.');
    },
    onError: (error) => toast.show(describeError(error), 'error'),
  });

  const busy = schedule.isPending || stop.isPending;

  // Inline rather than the router's ErrorScreen, which belongs to the error boundary: a failed
  // query is a retryable state on this screen, not a crashed render.
  if (status.isError) {
    return (
      <Screen scroll>
        <BackLink label="Back to settings" href="/(parent)/settings" />
        <Callout
          kind="danger"
          title={status.error instanceof NetworkError ? 'No connection' : 'Could not check your account'}
          live
        >
          {describeError(status.error)}
        </Callout>
        <Button label="Try again" onPress={() => void status.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <BackLink label="Back to settings" href="/(parent)/settings" />
      {/* The only red header in the app, so this can never be mistaken for a routine screen. */}
      <GradientHeader
        tone="danger"
        icon="trash"
        eyebrow="Settings"
        title="Delete account"
        subtitle={`Nothing is erased for ${status.data?.graceDays ?? 30} days, and you can cancel`}
      />

      {status.isPending || parents.isPending ? (
        <Card>
          <AppText style={[styles.detail, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      ) : status.data?.scheduled ? (
        <Scheduled
          status={status.data}
          canCancel={isPrimary === true}
          busy={busy}
          onCancel={() => stop.mutate()}
        />
      ) : isPrimary !== true ? (
        <Callout kind="info" title="Only the primary parent">
          The parent who created this family is the only one who can delete it. If you want to
          leave, ask them to remove you from Co-parents instead. That ends your access without
          touching anyone else&apos;s data.
        </Callout>
      ) : (
        <>
          <FormSection title="What gets deleted" icon="trash" tone="destructive" hint="For everyone in your family">
            {DELETED.map((line) => (
              <View key={line} style={styles.lossRow}>
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={palette.destructive[600]}
                  importantForAccessibility="no"
                  accessibilityElementsHidden
                />
                <AppText style={[styles.loss, { color: theme.cardForeground }]}>{line}</AppText>
              </View>
            ))}
            <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
              Nothing is erased for {status.data?.graceDays ?? 30} days, and you can cancel at any
              point in that window. After it passes, the data cannot be recovered by you or by us.
            </AppText>
          </FormSection>

          <Callout kind="warning" icon="lock-closed">
            Your children can&apos;t sign in while deletion is scheduled.
          </Callout>

          <FormSection title="Confirm it is you" icon="lock-closed" tone="primary">
            <Field
              testID="delete-password"
              label="Your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              editable={!busy}
              textContentType="password"
            />
            <Field
              testID="delete-confirm"
              label="Type DELETE to confirm"
              value={confirm}
              onChangeText={setConfirm}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              error={confirm.length > 0 && !confirmed(confirm) ? 'Type DELETE exactly' : undefined}
            />
            {/* Solid red: the one irreversible action in the app. The two gates carry the safety. */}
            <Button
              label="Schedule deletion"
              variant="danger"
              onPress={() => schedule.mutate()}
              busy={busy}
              disabled={password.length === 0 || !confirmed(confirm)}
            />
            <View style={styles.action}>
              <Button label="Go back" variant="secondary" onPress={() => router.back()} disabled={busy} />
            </View>
          </FormSection>
        </>
      )}

      <View style={styles.footer} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  emphasis: { fontWeight: fontWeight.bold },
  lossRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], marginBottom: spacing[2] },
  loss: { flex: 1, fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  detail: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[2],
  },
  action: { marginTop: spacing[3] },
  footer: { height: spacing[8] },
});
