/**
 * Co-parents: who has access, who has been invited, and how to change either.
 *
 * ## Removing a co-parent is behind a confirmation, and stays there
 *
 * This is one adult revoking another adult's access to their children's data. It is not comparable
 * to deleting a task, and it should not be one tap. The confirm names the person, because "are you
 * sure?" over a list is how the wrong row gets removed.
 *
 * Note the asymmetry with the devices screen, which is deliberate and consistent: a parent may sign
 * out a *child's* device but not a co-parent's. Co-parents are peers — removal ends their access
 * entirely and openly, rather than quietly killing a session.
 */
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { NetworkError } from '@/lib/api';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import {
  INVALIDATED_BY_FAMILY_WRITE,
  inviteCoParent,
  parentsQuery,
  removeCoParent,
  revokeInvitation,
} from '@/lib/familyApi';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

/** Good enough to catch a typo before a round trip; the server validates properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CoParents() {
  const theme = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuth((state) => state.user);

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null);

  const { data, error, isPending, isError, refetch } = useQuery(parentsQuery());

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_FAMILY_WRITE.map((key) => queryClient.invalidateQueries({ queryKey: key }))
    );
  }, [queryClient]);

  const { mutateAsync: doInvite } = useMutation({ mutationFn: inviteCoParent });
  const { mutateAsync: doRevoke } = useMutation({ mutationFn: revokeInvitation });
  const { mutateAsync: doRemove } = useMutation({ mutationFn: removeCoParent });

  const run = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setBusy(true);
      try {
        await action();
        await invalidate();
        toast.show(success, 'success');
        return true;
      } catch (caught) {
        toast.show(describeError(caught), 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [invalidate, toast]
  );

  if (isPending) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.detail, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <Card>
          <AppText style={[styles.name, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load co-parents'}
          </AppText>
          <AppText style={[styles.detail, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.action}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const emailValid = EMAIL.test(email.trim());

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          Co-parents
        </AppText>

        <Card>
          <AppText style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
            IN YOUR FAMILY
          </AppText>
          {data.parents.map((parent) => {
            const isMe = parent.id === me?.id;
            return (
              <View key={parent.id} style={[styles.row, { borderTopColor: theme.border }]}>
                <AppText style={[styles.name, { color: theme.cardForeground }]}>
                  {parent.firstName} {parent.lastName}
                  {isMe ? ' (you)' : ''}
                </AppText>
                <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
                  {parent.email}
                </AppText>
                {!isMe && (
                  <View style={styles.action}>
                    <Button
                      label="Remove"
                      variant="secondary"
                      onPress={() =>
                        setConfirmRemove({ id: parent.id, name: parent.firstName })
                      }
                      disabled={busy}
                    />
                  </View>
                )}
              </View>
            );
          })}
        </Card>

        {/* Named, not a generic "are you sure?" — that is how the wrong row gets removed. */}
        {confirmRemove && (
          <Card style={{ borderColor: theme.destructive, borderWidth: 2 }}>
            <AppText style={[styles.name, { color: theme.cardForeground }]}>
              Remove {confirmRemove.name}?
            </AppText>
            <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
              They will lose access to your children&apos;s data straight away. You can invite them
              again later.
            </AppText>
            <View style={styles.action}>
              <Button
                label={`Yes, remove ${confirmRemove.name}`}
                onPress={() => {
                  const target = confirmRemove;
                  void run(() => doRemove(target.id), `${target.name} removed`).then((ok) => {
                    if (ok) setConfirmRemove(null);
                  });
                }}
                disabled={busy}
              />
              <View style={styles.gap} />
              <Button
                label="Cancel"
                variant="secondary"
                onPress={() => setConfirmRemove(null)}
                disabled={busy}
              />
            </View>
          </Card>
        )}

        {data.pendingInvites.length > 0 && (
          <Card>
            <AppText style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
              INVITED, NOT YET ACCEPTED
            </AppText>
            {data.pendingInvites.map((invitation) => {
              const expires = asDate(invitation.expiresAt);
              return (
                <View key={invitation.id} style={[styles.row, { borderTopColor: theme.border }]}>
                  <AppText style={[styles.name, { color: theme.cardForeground }]}>
                    {invitation.email}
                  </AppText>
                  {expires && (
                    <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
                      Expires {expires.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </AppText>
                  )}
                  <View style={styles.action}>
                    <Button
                      label="Cancel invite"
                      variant="secondary"
                      onPress={() =>
                        void run(() => doRevoke(invitation.id), 'Invitation cancelled')
                      }
                      disabled={busy}
                    />
                  </View>
                </View>
              );
            })}
          </Card>
        )}

        <Card>
          <AppText style={[styles.sectionTitle, { color: theme.mutedForeground }]}>
            INVITE SOMEONE
          </AppText>
          <AppText style={[styles.detail, { color: theme.mutedForeground }]}>
            They get an email with a link. Nothing changes until they accept it.
          </AppText>
          <Field
            label="Their email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            editable={!busy}
          />
          <Button
            label="Send invitation"
            onPress={() => {
              void run(() => doInvite(email.trim()), 'Invitation sent').then((ok) => {
                if (ok) setEmail('');
              });
            }}
            busy={busy}
            disabled={busy || !emailValid}
          />
        </Card>

        <View style={styles.footer} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[4],
  },
  sectionTitle: {
    fontSize: fontSize.xs.fontSize,
    fontWeight: fontWeight.bold,
    letterSpacing: 1,
    marginBottom: spacing[2],
  },
  row: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  detail: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  action: { marginTop: spacing[3] },
  gap: { height: spacing[2] },
  footer: { height: spacing[8] },
});
