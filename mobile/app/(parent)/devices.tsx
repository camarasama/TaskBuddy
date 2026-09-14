/**
 * Signed-in devices.
 *
 * Not a tab — reached from the children screen, and hidden from the bar with `href: null` in the
 * layout. Six tabs do not fit a narrow phone, and this is a screen a parent visits when something has
 * happened, not daily.
 *
 * Two sections: the parent's own devices, and their children's. Signing out a co-parent is deliberately
 * impossible; the server scopes the children endpoint to `role: 'child'`, and there is no control here
 * for it either.
 *
 * The parent's *current* device is labelled and its button says what it will do. Signing yourself out
 * from a device list is a legitimate thing to want — it just should not be a surprise.
 */
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { NetworkError } from '@/lib/api';
import { dashboardQuery } from '@/lib/dashboardApi';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import {
  childSessionsQuery,
  deviceLabel,
  INVALIDATED_BY_REVOKE,
  mySessionsQuery,
  revokeChildSession,
  revokeMySession,
  type DeviceSession,
} from '@/lib/sessionsApi';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function lastSeen(session: DeviceSession): string {
  const at = asDate(session.lastActiveAt);
  if (!at) return 'Never used';
  return `Last used ${at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })} at ${at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

function DeviceRow({
  session,
  owner,
  busy,
  onRevoke,
}: {
  session: DeviceSession;
  owner: string | null;
  busy: boolean;
  onRevoke: () => void;
}) {
  const theme = useTheme();
  const isApp = session.client.startsWith('taskbuddy-android');

  return (
    <Card style={session.isCurrent ? { borderColor: theme.primary, borderWidth: 2 } : undefined}>
      <View style={styles.row}>
        <IconTile tone={isApp ? 'primary' : 'xp'} icon={isApp ? 'phone-portrait' : 'desktop'} size={44} />
        <View style={styles.grow}>
          <View style={styles.nameRow}>
            <AppText style={[styles.name, { color: theme.cardForeground }]}>
              {owner ? `${owner}: ` : ''}
              {deviceLabel(session)}
            </AppText>
            {session.isCurrent && <Chip compact variant="primary" label="This device" />}
          </View>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>{lastSeen(session)}</AppText>
          {session.ipAddress && (
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>From {session.ipAddress}</AppText>
          )}
        </View>
      </View>

      <View style={styles.action}>
        {/* Your own device is soft teal: signing yourself out is a legitimate choice, not a danger.
            Anyone else's is soft red, because it ends a session somebody else is using. */}
        <Button
          label={session.isCurrent ? 'Sign out this device' : 'Sign out'}
          variant={session.isCurrent ? 'soft' : 'softDanger'}
          onPress={onRevoke}
          disabled={busy}
        />
      </View>
    </Card>
  );
}

export default function Devices() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const mine = useQuery(mySessionsQuery());
  const children = useQuery(childSessionsQuery());
  // Only for names — the sessions endpoints return `userId` and nothing else about the person, and
  // "Android app, last used Tuesday" with no name is useless in a family with three children.
  const dashboard = useQuery(dashboardQuery());

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const child of dashboard.data?.children ?? []) {
      map.set(child.user.id, child.user.firstName);
    }
    return map;
  }, [dashboard.data]);

  const invalidate = useCallback(async () => {
    await Promise.all(
      INVALIDATED_BY_REVOKE.map((key) => queryClient.invalidateQueries({ queryKey: key }))
    );
  }, [queryClient]);

  const { mutateAsync: revokeMine } = useMutation({ mutationFn: revokeMySession });
  const { mutateAsync: revokeChild } = useMutation({ mutationFn: revokeChildSession });

  const runRevoke = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setActingId(id);
      setActionError(null);
      try {
        await action();
        await invalidate();
      } catch (caught) {
        // A 404 here means the session was already gone — another device revoked it, or it expired
        // between the list loading and the tap. Shown as-is rather than treated as success, because
        // the two are genuinely different and a security screen should not guess.
        setActionError(describeError(caught));
      } finally {
        setActingId(null);
      }
    },
    [invalidate]
  );

  const header = (
    <>
      <BackLink label="Back" />
      <GradientHeader
        tone="teal"
        icon="phone-portrait"
        eyebrow="Security"
        title="Signed-in devices"
        subtitle="Signing a device out ends its session straight away. It will need to sign in again."
      />
    </>
  );

  if (mine.isPending || children.isPending) {
    return (
      <Screen>
        {header}
        <Card>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Loading devices…</AppText>
        </Card>
      </Screen>
    );
  }

  if (mine.isError || children.isError) {
    const error = mine.error ?? children.error;
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        {header}
        <Callout kind="danger" title={offline ? 'No connection' : 'Could not load devices'} live>
          {describeError(error)}
        </Callout>
        <Button
          label="Try again"
          onPress={() => {
            void mine.refetch();
            void children.refetch();
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView>
        {header}

        {actionError !== null && (
          <Callout kind="danger" live>
            {actionError}
          </Callout>
        )}

        <SectionTitle title="Your devices" icon="phone-portrait" tone="primary" />
        {mine.data.sessions.length === 0 ? (
          <EmptyState emoji="📱" title="None signed in." />
        ) : (
          mine.data.sessions.map((session) => (
            <DeviceRow
              key={session.id}
              session={session}
              owner={null}
              busy={actingId === session.id}
              onRevoke={() => void runRevoke(session.id, () => revokeMine(session.id))}
            />
          ))
        )}

        <SectionTitle title="Your children's devices" icon="people" tone="xp" />
        {children.data.sessions.length === 0 ? (
          <EmptyState emoji="📱" title="No child has signed in on a device yet." />
        ) : (
          children.data.sessions.map((session) => (
            <DeviceRow
              key={session.id}
              session={session}
              owner={nameById.get(session.userId) ?? 'Child'}
              busy={actingId === session.id}
              onRevoke={() => void runRevoke(session.id, () => revokeChild(session.id))}
            />
          ))
        )}

        {/* Stated because its absence is a deliberate decision, not an oversight. */}
        <Callout kind="info">
          You can&apos;t sign out another parent&apos;s devices. Only they can do that, from their own
          account.
        </Callout>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  grow: { flex: 1 },
  nameRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  action: { marginTop: spacing[3] },
});
