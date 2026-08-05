/**
 * Past games.
 *
 * A flat list of finished sessions, newest first, each tapping through to its review. Deliberately not
 * grouped by category: the question a child asks here is "what did I just play and how did I do", which
 * is chronological. The per-category mastery view is the parent's report, not this.
 */
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { GAME_CATEGORY_LABELS, GAME_LEVEL_LABELS, type GameHistoryEntry } from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { historyQuery } from '@/lib/gamesApi';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function HistoryRow({ entry }: { entry: GameHistoryEntry }) {
  const theme = useTheme();
  const played = asDate(entry.playedAt);

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/(child)/games/review', params: { session: entry.sessionId } })
      }
      accessibilityRole="button"
      accessibilityLabel={`${GAME_CATEGORY_LABELS[entry.game.category]}, ${entry.correctCount} out of ${entry.totalQuestions}`}
    >
      <Card>
        <AppText style={[styles.title, { color: theme.cardForeground }]}>
          {GAME_CATEGORY_LABELS[entry.game.category]} · {GAME_LEVEL_LABELS[entry.game.level]}
        </AppText>
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
          {entry.correctCount} of {entry.totalQuestions} right
          {entry.pointsAwarded > 0 ? ` · +${entry.pointsAwarded} pts` : ''}
          {entry.xpAwarded > 0 ? ` · +${entry.xpAwarded} XP` : ''}
        </AppText>
        {played && (
          <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
            {played.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
            })}
          </AppText>
        )}
      </Card>
    </Pressable>
  );
}

export default function GameHistory() {
  const theme = useTheme();
  const { data, error, isPending, isError, refetch } = useQuery(historyQuery());

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
          <AppText style={[styles.title, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load your games'}
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

  return (
    <Screen>
      <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
        Past games
      </AppText>

      <FlatList
        data={data.sessions}
        keyExtractor={(item) => item.sessionId}
        renderItem={({ item }) => <HistoryRow entry={item} />}
        ListEmptyComponent={
          <Card>
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>
              You haven&apos;t finished a game yet.
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
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  footer: { marginTop: spacing[4] },
});
