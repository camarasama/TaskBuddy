/**
 * Achievements.
 *
 * The whole catalogue, locked ones included. Showing what is still out there is the point: a list of
 * only what has been earned tells a child nothing about what to aim for.
 *
 * **Earned first.** The screen used to render the catalogue in server order, which put a wall of greyed
 * "Locked" cards above the four a child had actually won, so the first thing they saw on their own
 * trophy shelf was everything they did not have. Unlocked achievements now lead, newest first, in their
 * tier's colour; locked ones follow under "Still to earn".
 *
 * Locked rows are greyed *and* carry a lock chip in words. Greying alone is not a status a screen reader
 * conveys, and it is indistinguishable from a rendering glitch.
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
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { NetworkError } from '@/lib/api';
import { achievementsQuery, type AchievementRow } from '@/lib/childProfileApi';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

/** Each tier's colour. Bronze reads as peach, silver as teal, and the top two keep gold and purple. */
const TIER_TONE: Record<string, AccentTone> = {
  bronze: 'peach',
  silver: 'primary',
  gold: 'gold',
  platinum: 'xp',
};

function Row({ item }: { item: AchievementRow }) {
  const theme = useTheme();
  const at = asDate(item.unlockedAt);
  const tone = (item.tier && TIER_TONE[item.tier]) || 'gold';

  return (
    <Card>
      <View style={styles.row}>
        <IconTile
          tone={tone}
          icon={item.unlocked ? 'trophy' : 'lock-closed'}
          size={48}
          muted={!item.unlocked}
        />
        <View style={styles.text}>
          <AppText
            style={[styles.name, { color: item.unlocked ? theme.cardForeground : theme.mutedForeground }]}
          >
            {item.name}
          </AppText>
          {item.description && (
            <AppText style={[styles.meta, { color: theme.mutedForeground }]}>{item.description}</AppText>
          )}
          <View style={styles.chips}>
            {item.unlocked ? (
              <Chip
                compact
                variant="done"
                icon="checkmark-circle"
                label={at ? `Unlocked ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'Unlocked'}
              />
            ) : (
              <Chip compact variant="info" icon="lock-closed" label="Locked" />
            )}
            <Chip compact variant="gold" icon="star" label={`${item.pointsReward} pts`} />
            <Chip compact variant="xp" icon="flash" label={`${item.xpReward} XP`} />
          </View>
        </View>
      </View>
    </Card>
  );
}

type ListRow =
  | { kind: 'section'; key: string; title: string; unlocked: boolean }
  | { kind: 'item'; key: string; item: AchievementRow };

function toRows(achievements: AchievementRow[]): ListRow[] {
  const unlocked = achievements
    .filter((a) => a.unlocked)
    .sort((a, b) => (asDate(b.unlockedAt)?.getTime() ?? 0) - (asDate(a.unlockedAt)?.getTime() ?? 0));
  const locked = achievements.filter((a) => !a.unlocked);

  const rows: ListRow[] = [];
  if (unlocked.length > 0) {
    rows.push({ kind: 'section', key: 'section-unlocked', title: 'Unlocked', unlocked: true });
    rows.push(...unlocked.map((item) => ({ kind: 'item' as const, key: item.id, item })));
  }
  if (locked.length > 0) {
    rows.push({ kind: 'section', key: 'section-locked', title: 'Still to earn', unlocked: false });
    rows.push(...locked.map((item) => ({ kind: 'item' as const, key: item.id, item })));
  }
  return rows;
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
        <Card status="late">
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

  const { stats } = data;
  const percent = stats.total > 0 ? (stats.unlocked / stats.total) * 100 : 0;

  return (
    <Screen>
      <BackLink label="Back to Me" href="/(child)/me" />
      <FlatList
        data={toRows(data.achievements)}
        keyExtractor={(row) => row.key}
        ListHeaderComponent={
          <GradientHeader
            tone="gold"
            icon="trophy"
            eyebrow="Achievements"
            title={`${stats.unlocked} of ${stats.total}`}
            subtitle={`Worth ${stats.totalPointsEarned} points and ${stats.totalXpEarned} XP so far`}
          >
            <ProgressBar
              percent={percent}
              variant="xp"
              label={`${stats.unlocked} of ${stats.total} achievements unlocked`}
            />
          </GradientHeader>
        }
        renderItem={({ item: row }) =>
          row.kind === 'section' ? (
            <SectionTitle
              title={row.title}
              icon={row.unlocked ? 'ribbon' : 'lock-closed'}
              tone={row.unlocked ? 'gold' : 'primary'}
            />
          ) : (
            <Row item={row.item} />
          )
        }
        ListEmptyComponent={<EmptyState emoji="🏆" title="No achievements set up yet." />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  text: { flex: 1 },
  name: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  meta: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  footer: { marginTop: spacing[4] },
});
