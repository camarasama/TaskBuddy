/**
 * Children screen.
 *
 * Richer than the dashboard's summary rows: lifetime totals, both streaks, and the sign-in identity a
 * parent actually gets asked for ("what's my username again?").
 *
 * Read-only for now. Editing a child, resetting a PIN and approving a chosen avatar photo all exist on
 * the web; the first two are ordinary follow-ups, but the avatar one is deliberately not here — see the
 * note further down.
 */
import { useMemo } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { childrenQuery, type ChildMember } from '@/lib/childrenApi';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function Stat({ label, value }: { label: string; value: string | number }) {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <AppText style={[styles.statValue, { color: theme.cardForeground }]}>{value}</AppText>
      <AppText style={[styles.statLabel, { color: theme.mutedForeground }]} numberOfLines={2}>
        {label}
      </AppText>
    </View>
  );
}

function ChildCard({ child }: { child: ChildMember }) {
  const theme = useTheme();
  const profile = child.childProfile;
  const lastSeen = asDate(child.lastLoginAt);

  return (
    <Card>
      <View style={styles.header}>
        <AppText style={[styles.name, { color: theme.cardForeground }]} numberOfLines={1}>
          {profile.avatarEmoji ? `${profile.avatarEmoji} ` : ''}
          {child.firstName} {child.lastName}
        </AppText>
        {/* Levels come straight from the server — see the note in childrenApi.ts on why nothing here
            derives a level or a progress bar. */}
        <AppText style={[styles.level, { color: theme.primary }]}>Level {profile.level}</AppText>
      </View>

      {/* The question parents are actually asked, so it is on the card rather than a detail screen. */}
      <AppText style={[styles.identity, { color: theme.mutedForeground }]}>
        {child.username ? `Signs in as “${child.username}”` : 'No username set — add one on the web'}
      </AppText>

      <View style={styles.statRow}>
        <Stat label="Points to spend" value={profile.pointsBalance} />
        <Stat label="Earned all time" value={profile.totalPointsEarned} />
        <Stat label="Tasks completed" value={profile.totalTasksCompleted} />
        <Stat label="XP this level" value={profile.experiencePoints} />
      </View>

      <View style={[styles.streaks, { borderTopColor: theme.border }]}>
        <AppText style={[styles.streakText, { color: theme.mutedForeground }]}>
          {profile.currentStreakDays > 0
            ? `${profile.currentStreakDays}-day streak`
            : 'No streak right now'}
          {profile.longestStreakDays > 0 ? ` · best ${profile.longestStreakDays}` : ''}
        </AppText>
        <AppText style={[styles.streakText, { color: theme.mutedForeground }]}>
          {lastSeen
            ? `Last signed in ${lastSeen.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
            : 'Has not signed in yet'}
        </AppText>
      </View>

      {/*
        A photo the child chose is waiting for review. Flagged, not shown.

        Displaying it would put a child's photograph on this screen, and `PRIVACY.md` plus the Play
        Data safety form still need updating for children's photos before that ships anywhere near
        production — a Families-policy item, not a styling one. Reviewing on the web is the honest
        instruction until that is done.
      */}
      {profile.pendingAvatarUrl ? (
        <AppText style={[styles.pending, { color: theme.primary }]}>
          A profile photo is waiting for your review — approve or decline it on the web.
        </AppText>
      ) : null}
    </Card>
  );
}

export default function Children() {
  const theme = useTheme();
  const { data, error, isPending, isError, refetch, isRefetching } = useQuery(childrenQuery());

  const children = useMemo(() => data ?? [], [data]);

  const header = (
    <View>
      <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>Children</AppText>
      <AppText style={[styles.subtitle, { color: theme.mutedForeground }]}>
        {isPending
          ? 'Loading…'
          : `${children.length} ${children.length === 1 ? 'child' : 'children'}`}
      </AppText>
    </View>
  );

  if (isError) {
    return (
      <Screen>
        {header}
        <Card>
          <AppText style={[styles.cardTitle, { color: theme.destructive }]}>
            {error instanceof NetworkError ? 'No connection' : 'Could not load your children'}
          </AppText>
          <AppText style={[styles.streakText, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={children}
        keyExtractor={(child) => child.id}
        renderItem={({ item }) => <ChildCard child={item} />}
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
              <AppText style={[styles.streakText, { color: theme.cardForeground }]}>
                No children yet. Adding one is on the web for now.
              </AppText>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing[3],
  },
  name: {
    flex: 1,
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  level: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.bold },
  identity: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    marginTop: spacing[1],
  },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing[3] },
  stat: { width: '50%', paddingVertical: spacing[2], paddingRight: spacing[2] },
  statValue: {
    fontSize: fontSize.xl.fontSize,
    lineHeight: fontSize.xl.lineHeight,
    fontWeight: fontWeight.bold,
  },
  statLabel: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight },
  streaks: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[2], gap: spacing[1] },
  streakText: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight },
  pending: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.medium,
    marginTop: spacing[3],
  },
  centred: { paddingVertical: spacing[6], alignItems: 'center' },
});
