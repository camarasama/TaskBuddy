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
import {
  GAME_CATEGORY_EMOJI,
  GAME_CATEGORY_LABELS,
  GAME_LEVEL_LABELS,
  GAME_REWARD_ACCURACY_FLOOR,
  type GameHistoryEntry,
} from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { historyQuery } from '@/lib/gamesApi';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';
import { CATEGORY_TINT } from '@/theme/gameTints';

function HistoryRow({ entry }: { entry: GameHistoryEntry }) {
  const theme = useTheme();
  const played = asDate(entry.playedAt);
  const tint = CATEGORY_TINT[entry.game.category];
  // The same floor the server pays against, so "Passed" here means points or XP were actually earned.
  const passed = entry.totalQuestions > 0 && entry.correctCount / entry.totalQuestions >= GAME_REWARD_ACCURACY_FLOOR;

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/(child)/games/review', params: { session: entry.sessionId } })
      }
      accessibilityRole="button"
      accessibilityLabel={`${GAME_CATEGORY_LABELS[entry.game.category]}, ${entry.correctCount} out of ${entry.totalQuestions}`}
    >
      <Card>
        <View style={styles.row}>
          {/* The subject's own emoji and colour, the same as on the picker. */}
          <View style={[styles.tile, { backgroundColor: tint.fill }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <AppText style={styles.tileEmoji}>{GAME_CATEGORY_EMOJI[entry.game.category]}</AppText>
          </View>
          <View style={styles.grow}>
            <AppText style={[styles.title, { color: theme.cardForeground }]}>
              {GAME_CATEGORY_LABELS[entry.game.category]} · {GAME_LEVEL_LABELS[entry.game.level]}
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
            <View style={styles.chips}>
              <Chip
                compact
                variant={passed ? 'done' : 'pending'}
                icon={passed ? 'checkmark-circle' : 'refresh'}
                label={`${entry.correctCount} of ${entry.totalQuestions} right`}
              />
              {entry.pointsAwarded > 0 && <Chip compact variant="gold" icon="star" label={`+${entry.pointsAwarded} pts`} />}
              {entry.xpAwarded > 0 && <Chip compact variant="xp" icon="flash" label={`+${entry.xpAwarded} XP`} />}
            </View>
          </View>
        </View>
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
        <BackLink label="Back to Games" href="/(child)/games" />
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
        <BackLink label="Back to Games" href="/(child)/games" />
        <Card status="late">
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
      <BackLink label="Back to Games" href="/(child)/games" />
      <FlatList
        data={data.sessions}
        keyExtractor={(item) => item.sessionId}
        ListHeaderComponent={
          <GradientHeader
            tone="brand"
            icon="time"
            eyebrow="Games"
            title="Past games"
            subtitle={`${data.sessions.length} ${data.sessions.length === 1 ? 'game' : 'games'} finished`}
          />
        }
        renderItem={({ item }) => <HistoryRow entry={item} />}
        ListEmptyComponent={<EmptyState emoji="🎮" title="You haven't finished a game yet." />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  tile: { width: 48, height: 48, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  // No lineHeight: an emoji sized against a line box gets clipped at the top on Android.
  tileEmoji: { fontSize: 24 },
  grow: { flex: 1 },
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  footer: { marginTop: spacing[4] },
});
