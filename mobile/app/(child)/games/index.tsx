/**
 * Game picker — the category × level grid.
 *
 * Six categories down, three levels across. Every category is drawn from the shared constants rather
 * than from the payload, so one with no authored content shows as an explicitly empty row instead of
 * silently vanishing: a content gap is worth seeing, a category that disappears reads as a bug.
 *
 * ## Cooldown is a row, not a cell
 *
 * Completing any maths game holds *every* maths game. Saying so once per row — "back in 3h" beside the
 * category name — is both accurate and less alarming than three greyed cells with no explanation. The
 * flag comes from the server; nothing here recomputes it from timestamps.
 *
 * Level is freely selectable at any age by design. Appropriateness lives in the authored questions, not
 * in a gate on the picker, so a confident nine-year-old can play `hard` and a struggling teenager can
 * play `beginner` without either being told they may not.
 */
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import {
  GAME_CATEGORY_LABELS,
  GAME_LEVEL_LABELS,
  GAME_REWARDS,
  type GameDefinition,
} from '@taskbuddy/shared';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { cooldownLabel, gamesQuery, groupByCategory, type CategoryGroup } from '@/lib/gamesApi';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

function LevelButton({
  game,
  level,
  locked,
  onPlay,
}: {
  game: GameDefinition | null;
  level: keyof typeof GAME_LEVEL_LABELS;
  locked: boolean;
  onPlay: (game: GameDefinition) => void;
}) {
  const theme = useTheme();
  const reward = GAME_REWARDS[level];

  // No authored game at this combination. Shown rather than hidden so the grid stays a grid — three
  // cells that sometimes become two make the row jump between categories.
  if (!game) {
    return (
      <View style={[styles.cell, { borderColor: theme.border, opacity: 0.5 }]}>
        <AppText style={[styles.cellLabel, { color: theme.mutedForeground }]}>
          {GAME_LEVEL_LABELS[level]}
        </AppText>
        <AppText style={[styles.cellMeta, { color: theme.mutedForeground }]}>—</AppText>
      </View>
    );
  }

  return (
    <View style={[styles.cell, { borderColor: locked ? theme.border : theme.primary }]}>
      <AppText style={[styles.cellLabel, { color: theme.cardForeground }]}>
        {GAME_LEVEL_LABELS[level]}
      </AppText>
      <AppText style={[styles.cellMeta, { color: theme.mutedForeground }]}>
        {reward.points} pts · {reward.xp} XP
      </AppText>
      <Button
        label={locked ? 'Locked' : 'Play'}
        variant={locked ? 'secondary' : 'primary'}
        onPress={() => onPlay(game)}
        disabled={locked}
      />
    </View>
  );
}

function CategoryRow({
  group,
  onPlay,
}: {
  group: CategoryGroup;
  onPlay: (game: GameDefinition) => void;
}) {
  const theme = useTheme();
  const back = cooldownLabel(group.cooldownEndsAt);

  return (
    <Card>
      <View style={styles.categoryHeader}>
        <AppText style={[styles.categoryName, { color: theme.cardForeground }]}>
          {GAME_CATEGORY_LABELS[group.category]}
        </AppText>
        {group.onCooldown && (
          // Stated in words, once, for the whole row — three greyed cells with no reason is the most
          // common way a rules-heavy grid reads as broken.
          <AppText style={[styles.cooldown, { color: theme.mutedForeground }]}>
            {back ?? 'resting'}
          </AppText>
        )}
      </View>

      <View style={styles.cellRow}>
        {group.levels.map((cell) => (
          <LevelButton
            key={cell.level}
            game={cell.game}
            level={cell.level}
            locked={group.onCooldown}
            onPlay={onPlay}
          />
        ))}
      </View>
    </Card>
  );
}

export default function GamePicker() {
  const theme = useTheme();
  const { data, error, isPending, isError, refetch } = useQuery(gamesQuery());
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  /**
   * Launch straight into play with the game id.
   *
   * The session is created on the play screen rather than here, so a mis-tap that immediately backs out
   * does not burn a session — and creating one expires any previous in-progress session for that game.
   */
  const onPlay = useCallback((game: GameDefinition) => {
    router.push({ pathname: '/(child)/games/play', params: { gameId: game.id } });
  }, []);

  if (isPending) {
    return (
      <Screen>
        <Card>
          <AppText style={[styles.cellMeta, { color: theme.mutedForeground }]}>Loading games…</AppText>
        </Card>
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <Card>
          <AppText style={[styles.categoryName, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load games'}
          </AppText>
          <AppText style={[styles.cellMeta, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.footer}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const groups = groupByCategory(data.games);

  return (
    <Screen>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      >
        <AppText variant="display" style={[styles.title, { color: theme.foreground }]}>
          Play a game
        </AppText>

        {groups.map((group) => (
          <CategoryRow key={group.category} group={group} onPlay={onPlay} />
        ))}

        <View style={styles.footer}>
          <Button
            label="Past games"
            variant="secondary"
            onPress={() => router.push('/(child)/games/history')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[4],
  },
  categoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: spacing[3],
    gap: spacing[2],
  },
  categoryName: {
    fontSize: fontSize.lg.fontSize,
    lineHeight: fontSize.lg.lineHeight,
    fontWeight: fontWeight.bold,
  },
  cooldown: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.medium },
  cellRow: { flexDirection: 'row', gap: spacing[2] },
  cell: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing[2],
    gap: spacing[1],
    minHeight: minTouchTarget,
    justifyContent: 'space-between',
  },
  cellLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.semibold },
  cellMeta: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight },
  footer: { marginTop: spacing[4], marginBottom: spacing[6] },
});
