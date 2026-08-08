/**
 * Achievements.
 *
 * The whole catalogue, locked ones included. Showing what is still out there is the point — a list of
 * only what has been earned tells a child nothing about what to aim for.
 *
 * Locked rows are dimmed *and* labelled "Locked". Opacity alone is not a status a screen reader conveys,
 * and it is also indistinguishable from a rendering glitch.
 */
import { FlatList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { achievementsQuery, type AchievementRow } from '@/lib/childProfileApi';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function Row({ item }: { item: AchievementRow }) {
  const theme = useTheme();
  const at = asDate(item.unlockedAt);

  return (
    <Card style={item.unlocked ? undefined : { opacity: 0.6 }}>
      <AppText style={[styles.name, { color: theme.cardForeground }]}>
        {item.name}
        {item.unlocked ? '' : ' — Locked'}
      </AppText>
      {item.description && (
        <AppText style={[styles.meta, { color: theme.mutedForeground }]}>{item.description}</AppText>
      )}
      <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
        {item.unlocked && at
          ? `Unlocked ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
          : `Worth ${item.pointsReward} points · ${item.xpReward} XP`}
      </AppText>
    </Card>
  );
}

export default function Achievements() {
  const theme = useTheme();
  const { data, error, isPending, isError, refetch } = useQuery(achievementsQuery());

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
        <Card>
          <AppText style={[styles.name, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load achievements'}
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
      <BackLink label="Back to Me" href="/(child)/me" />
      <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
        {data.stats.unlocked} of {data.stats.total}
      </AppText>
      <AppText style={[styles.meta, { color: theme.mutedForeground }]}>
        Worth {data.stats.totalPointsEarned} points and {data.stats.totalXpEarned} XP so far
      </AppText>

      <FlatList
        data={data.achievements}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <Row item={item} />}
        ListEmptyComponent={
          <Card>
            <AppText style={[styles.meta, { color: theme.cardForeground }]}>
              No achievements set up yet.
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
  },
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  footer: { marginTop: spacing[4] },
});
