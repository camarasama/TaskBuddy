/**
 * Family leaderboard.
 *
 * ## The case this screen exists to get right
 *
 * `enableLeaderboard` is a family setting a parent can switch off, and families with one child who
 * always loses switch it off deliberately. When it is off the endpoint returns `enabled: false` with an
 * empty list, which, rendered naively, tells a child their siblings have scored nothing. That is worse
 * than saying nothing at all, so the two cases have separate copy and the response type is a union that
 * forces the distinction to be handled.
 *
 * Scores are the server's: `points + tasks×5 + streak×2`. Not recomputed here: a leaderboard whose
 * ranks disagree with the numbers beside them is worse than no leaderboard.
 *
 * The top three get a medal and the child's own row is ringed and labelled "You", so a child finds
 * themselves by looking. The rank is still spoken, since a medal emoji alone is not a position.
 */
import { FlatList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { leaderboardQuery, type LeaderboardEntry } from '@/lib/childProfileApi';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

const MEDAL: Record<number, { emoji: string; tone: AccentTone }> = {
  1: { emoji: '🥇', tone: 'gold' },
  2: { emoji: '🥈', tone: 'primary' },
  3: { emoji: '🥉', tone: 'peach' },
};

function Row({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  const theme = useTheme();
  const medal = MEDAL[entry.rank];

  return (
    <Card style={isMe ? { borderColor: theme.primary, borderWidth: 2 } : undefined}>
      <View
        style={styles.row}
        accessible
        accessibilityLabel={`Rank ${entry.rank}, ${entry.childName}${isMe ? ', you' : ''}, ${entry.weeklyPoints} points, ${entry.weeklyTasks} tasks`}
      >
        {medal ? (
          <IconTile tone={medal.tone} emoji={medal.emoji} size={48} />
        ) : (
          <View style={[styles.rank, { backgroundColor: theme.muted }]}>
            <AppText style={[styles.rankLabel, { color: theme.mutedForeground }]}>{entry.rank}</AppText>
          </View>
        )}
        <View style={styles.text}>
          <View style={styles.nameRow}>
            <AppText style={[styles.name, { color: theme.cardForeground }]}>{entry.childName}</AppText>
            {isMe && <Chip compact variant="primary" label="You" />}
          </View>
          <View style={styles.chips}>
            <Chip compact variant="gold" icon="star" label={`${entry.weeklyPoints} pts`} />
            <Chip compact variant="done" icon="checkbox" label={`${entry.weeklyTasks} tasks`} />
            {entry.currentStreak > 0 && (
              <Chip compact variant="peach" icon="flame" label={`${entry.currentStreak}-day streak`} />
            )}
          </View>
        </View>
      </View>
    </Card>
  );
}

export default function Leaderboard() {
  const theme = useTheme();
  const user = useAuth((state) => state.user);
  const { data, error, isPending, isError, refetch } = useQuery(leaderboardQuery());

  if (isPending) {
    return (
      <Screen>
        <BackLink label="Back to Me" href="/(child)/me" />
        <Card>
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>Loading…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <BackLink label="Back to Me" href="/(child)/me" />
        <Card status="late">
          <AppText style={[styles.name, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load the leaderboard'}
          </AppText>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.footer}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  // Switched off by a parent: deliberately worded as a family choice, not as an absence of scores.
  if (!data.enabled) {
    return (
      <Screen>
        <BackLink label="Back to Me" href="/(child)/me" />
        <GradientHeader tone="brand" icon="podium" eyebrow="Family leaderboard" title="Leaderboard" />
        <EmptyState
          emoji="🏡"
          title="Your family has the leaderboard turned off."
          message="You can still see everything you've done in Your week."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <BackLink label="Back to Me" href="/(child)/me" />
      <FlatList
        data={data.entries}
        keyExtractor={(item) => item.childId}
        ListHeaderComponent={
          <GradientHeader
            tone="brand"
            icon="podium"
            eyebrow="Family leaderboard"
            title="This week"
            subtitle="Points, tasks and streaks"
          />
        }
        renderItem={({ item }) => <Row entry={item} isMe={item.childId === user?.id} />}
        ListEmptyComponent={<EmptyState emoji="🏁" title="No scores yet this week." />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  rank: { width: 48, height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  rankLabel: { fontSize: fontSize.lg.fontSize, fontWeight: fontWeight.bold },
  text: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  footer: { marginTop: spacing[4] },
});
