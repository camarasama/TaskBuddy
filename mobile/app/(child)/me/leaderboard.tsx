/**
 * Family leaderboard.
 *
 * ## The case this screen exists to get right
 *
 * `enableLeaderboard` is a family setting a parent can switch off, and families with one child who
 * always loses switch it off deliberately. When it is off the endpoint returns `enabled: false` with an
 * empty list — which, rendered naively, tells a child their siblings have scored nothing. That is worse
 * than saying nothing at all, so the two cases have separate copy and the response type is a union that
 * forces the distinction to be handled.
 *
 * Scores are the server's: `points + tasks×5 + streak×2`. Not recomputed here — a leaderboard whose
 * ranks disagree with the numbers beside them is worse than no leaderboard.
 */
import { FlatList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { leaderboardQuery, type LeaderboardEntry } from '@/lib/childProfileApi';
import { describeError } from '@/lib/errors';
import { useAuth } from '@/stores/auth';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function Row({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  const theme = useTheme();

  return (
    <Card style={isMe ? { borderColor: theme.primary, borderWidth: 2 } : undefined}>
      <AppText style={[styles.name, { color: theme.cardForeground }]}>
        {entry.rank}. {entry.childName}
        {isMe ? ' (you)' : ''}
      </AppText>
      <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
        {entry.weeklyPoints} points · {entry.weeklyTasks} tasks
        {entry.currentStreak > 0 ? ` · ${entry.currentStreak}-day streak` : ''}
      </AppText>
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
        <Card>
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

  // Switched off by a parent — deliberately worded as a family choice, not as an absence of scores.
  if (!data.enabled) {
    return (
      <Screen>
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          Leaderboard
        </AppText>
        <Card>
          <AppText style={[styles.meta, { color: theme.cardForeground }]}>
            Your family has the leaderboard turned off. You can still see everything you&apos;ve done
            in Your week.
          </AppText>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
        This week
      </AppText>

      <FlatList
        data={data.entries}
        keyExtractor={(item) => item.childId}
        renderItem={({ item }) => <Row entry={item} isMe={item.childId === user?.id} />}
        ListEmptyComponent={
          <Card>
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>
              No scores yet this week.
            </AppText>
          </Card>
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[3],
  },
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  footer: { marginTop: spacing[4] },
});
