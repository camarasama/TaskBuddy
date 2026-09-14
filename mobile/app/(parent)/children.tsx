/**
 * Children screen.
 *
 * Richer than the dashboard's summary rows: lifetime totals, both streaks, and the sign-in identity a
 * parent actually gets asked for ("what's my username again?"). Tapping a child opens the edit form,
 * which is also where extra time and a holiday pause live.
 *
 * Purple is the children's colour across the app (their own home screen opens on it), so the masthead
 * here is purple rather than the parent teal.
 *
 * A photo a child picked for themselves is flagged here but reviewed on the web; see the note on
 * `pendingAvatarUrl` below.
 */
import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { NavTile } from '@/components/NavTile';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { StatTile } from '@/components/StatTile';
import { NetworkError } from '@/lib/api';
import { childrenQuery, type ChildMember } from '@/lib/childrenApi';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function ChildCard({ child }: { child: ChildMember }) {
  const theme = useTheme();
  const profile = child.childProfile;
  const lastSeen = asDate(child.lastLoginAt);

  return (
    <Card>
      <View style={styles.header}>
        <Avatar seed={child.id} name={child.firstName} size={52} />
        <View style={styles.grow}>
          <AppText style={[styles.name, { color: theme.cardForeground }]} numberOfLines={1}>
            {profile.avatarEmoji ? `${profile.avatarEmoji} ` : ''}
            {child.firstName} {child.lastName}
          </AppText>
          <View style={styles.chips}>
            {/* The sign-in identity: what a parent is asked for when a child forgets. */}
            {child.username ? (
              <Chip compact variant="info" icon="person" label={`Signs in as ${child.username}`} />
            ) : (
              <Chip compact variant="pending" label="No username yet" />
            )}
            <Chip compact variant="xp" label={`Level ${profile.level}`} />
          </View>
        </View>
        <Ionicons
          name="chevron-forward"
          size={20}
          color={theme.mutedForeground}
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
      </View>

      <View style={styles.statRow}>
        <StatTile value={profile.pointsBalance} label="Points to spend" variant="gold" />
        <StatTile value={profile.totalTasksCompleted} label="Tasks done" variant="success" />
      </View>
      <View style={styles.statRow}>
        <StatTile value={profile.experiencePoints} label="XP this level" variant="xp" />
        <StatTile
          value={profile.currentStreakDays}
          label={profile.longestStreakDays > 0 ? `Day streak, best ${profile.longestStreakDays}` : 'Day streak'}
          variant="peach"
        />
      </View>

      <View style={styles.seen}>
        <Ionicons name="time-outline" size={16} color={theme.mutedForeground} importantForAccessibility="no" accessibilityElementsHidden />
        <AppText style={[styles.seenText, { color: theme.mutedForeground }]}>
          {lastSeen
            ? `Last signed in ${lastSeen.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
            : 'Has not signed in yet'}
        </AppText>
      </View>

      {/*
        A photo the child chose is waiting for review. Flagged, not shown: displaying it would put a
        child's photograph on this list, which is a Families-policy decision rather than a styling one.
        Reviewing on the web is the honest instruction until that is decided.
      */}
      {profile.pendingAvatarUrl ? (
        <View style={styles.pending}>
          <Callout kind="warning" icon="image-outline">
            A profile photo is waiting for your review. Approve or decline it on the web.
          </Callout>
        </View>
      ) : null}
    </Card>
  );
}

export default function Children() {
  const theme = useTheme();
  const { data, error, isPending, isError, refetch, isRefetching } = useQuery(childrenQuery());
  const children = useMemo(() => data ?? [], [data]);

  const header = (
    <GradientHeader
      tone="brand"
      icon="people"
      eyebrow="Children"
      title={isPending ? 'Loading…' : `${children.length} ${children.length === 1 ? 'child' : 'children'}`}
      subtitle="Tap a child to edit, give extra time or pause a streak"
      actions={[{ label: 'Add a child', icon: 'add', onPress: () => router.push('/(parent)/child-form') }]}
    />
  );

  if (isError) {
    return (
      <Screen>
        {header}
        <Callout kind="danger" title={error instanceof NetworkError ? 'No connection' : 'Could not load your children'} live>
          {describeError(error)}
        </Callout>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={children}
        keyExtractor={(child) => child.id}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/(parent)/child-form', params: { id: item.id } })}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.firstName}`}
          >
            <ChildCard child={item} />
          </Pressable>
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
            <EmptyState emoji="👋" title="No children yet." message='Tap "Add a child" to make one.' />
          )
        }
        ListFooterComponent={
          <View>
            <SectionTitle title="Signing in" icon="qr-code" tone="primary" />
            <NavTile
              title="Family code"
              icon="qr-code"
              tone="primary"
              subtitle="Let a child sign in by scanning it"
              onPress={() => router.push('/(parent)/family-code')}
            />
            <NavTile
              title="Signed-in devices"
              icon="phone-portrait"
              tone="peach"
              subtitle="See your children's devices and sign them out"
              onPress={() => router.push('/(parent)/devices')}
            />
          </View>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: spacing[6] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  grow: { flex: 1 },
  name: { fontSize: fontSize.base.fontSize, lineHeight: fontSize.base.lineHeight, fontWeight: fontWeight.semibold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1], marginTop: spacing[1] },
  statRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] },
  seen: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[3] },
  seenText: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  pending: { marginTop: spacing[3], marginBottom: -spacing[4] },
  centred: { paddingVertical: spacing[6], alignItems: 'center' },
});
