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
import { Avatar } from '@/components/Avatar';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Field';
import { FormSection } from '@/components/FormSection';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
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

  const header = (
    <>
      <BackLink label="Back to settings" href="/(parent)/settings" />
      <GradientHeader
        tone="brand"
        icon="people"
        eyebrow="Settings"
        title="Co-parents"
        subtitle="Adults who can manage this family"
      />
    </>
  );

  if (isPending) {
    return (
      <Screen>
        {header}
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
        {header}
        <Callout kind="danger" title={offline ? 'No connection' : 'Could not load co-parents'} live>
          {describeError(error)}
        </Callout>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  const emailValid = EMAIL.test(email.trim());

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        {header}

        <SectionTitle title="In your family" icon="people" tone="xp" />
        <Card>
          {data.parents.map((parent, index) => {
            const isMe = parent.id === me?.id;
            return (
              <View
                key={parent.id}
                style={[styles.row, { borderTopColor: theme.border }, index === 0 && styles.firstRow]}
              >
                <View style={styles.person}>
                  <Avatar seed={parent.id} name={parent.firstName} size={40} />
                  <View style={styles.grow}>
                    <AppText style={[styles.name, { color: theme.cardForeground }]}>
                      {parent.firstName} {parent.lastName}
                    </AppText>
                    <AppText style={[styles.detail, { color: theme.mutedForeground }]}>{parent.email}</AppText>
                  </View>
                  <View style={styles.badges}>
                    {isMe && <Chip compact variant="primary" label="You" />}
                    {parent.isPrimaryParent && <Chip compact variant="info" icon="shield-checkmark" label="Owner" />}
                  </View>
                </View>
                {!isMe && (
                  <View style={styles.action}>
                    <Button
                      label="Remove"
                      variant="softDanger"
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

        {/* Named, not a generic "are you sure?": that is how the wrong row gets removed. */}
        {confirmRemove && (
          <Callout kind="danger" icon="person-remove" title={`Remove ${confirmRemove.name}?`}>
            <AppText style={[styles.detail, { color: theme.cardForeground }]}>
              They will lose access to your children&apos;s data straight away. You can invite them
              again later.
            </AppText>
            <View style={styles.action}>
              <Button
                label={`Yes, remove ${confirmRemove.name}`}
                variant="danger"
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
          </Callout>
        )}

        {data.pendingInvites.length > 0 && (
          <>
            <SectionTitle title="Invited, not yet accepted" icon="mail" tone="warning" />
            <Card>
              {data.pendingInvites.map((invitation, index) => {
                const expires = asDate(invitation.expiresAt);
                return (
                  <View
                    key={invitation.id}
                    style={[styles.row, { borderTopColor: theme.border }, index === 0 && styles.firstRow]}
                  >
                    <View style={styles.person}>
                      <IconTile tone="warning" icon="mail" size={40} />
                      <View style={styles.grow}>
                        <AppText style={[styles.name, { color: theme.cardForeground }]}>{invitation.email}</AppText>
                        {expires && (
                          <View style={styles.chips}>
                            <Chip
                              compact
                              variant="pending"
                              icon="time"
                              label={`Expires ${expires.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`}
                            />
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={styles.action}>
                      <Button
                        label="Cancel invite"
                        variant="softDanger"
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
          </>
        )}

        <FormSection
          title="Invite someone"
          icon="send"
          tone="primary"
          hint="They get an email with a link. Nothing changes until they accept it."
        >
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
        </FormSection>

        <View style={styles.footer} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  firstRow: { borderTopWidth: 0, paddingTop: 0, marginTop: 0 },
  person: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', marginTop: spacing[1] },
  badges: { alignItems: 'flex-end', gap: spacing[1] },
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
