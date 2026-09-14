/**
 * Weekly recap.
 *
 * The one place the app looks back rather than forward.
 *
 * `quietWeek` is honoured literally: when the server says nothing happened, this says nothing happened.
 * The temptation is to fill the space with encouragement, and a child who did nothing all week knows
 * they did nothing. Manufactured praise for it is the fastest way to make every other message on the
 * screen untrustworthy. The colour changes nothing about that: a quiet week gets a calm header, not a
 * celebratory one.
 */
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import { IconTile, type IoniconName } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { StatTile } from '@/components/StatTile';
import { NetworkError } from '@/lib/api';
import { recapQuery } from '@/lib/childProfileApi';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';
import type { AccentTone } from '@/theme/accents';

/** A card that leads with a coloured tile: best day, streak, team-ups. */
function Highlight({ icon, tone, title, children }: {
  icon: IoniconName;
  tone: AccentTone;
  title: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Card>
      <View style={styles.highlight}>
        <IconTile tone={tone} icon={icon} size={44} />
        <View style={styles.grow}>
          <AppText style={[styles.title, { color: theme.cardForeground }]}>{title}</AppText>
          {children}
        </View>
      </View>
    </Card>
  );
}

export default function Recap() {
  const theme = useTheme();
  const { data, error, isPending, isError, refetch } = useQuery(recapQuery());

  if (isPending) {
    return (
      <Screen>
        <BackLink label="Back to Me" href="/(child)/me" />
        <Card>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>Loading…</AppText>
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
          <AppText style={[styles.title, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load your week'}
          </AppText>
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.footer}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const best = data.bestDay;
  const bestDate = asDate(best?.date);

  return (
    <Screen>
      <BackLink label="Back to Me" href="/(child)/me" />
      <ScrollView>
        <GradientHeader
          tone={data.quietWeek ? 'teal' : 'success'}
          icon="calendar"
          eyebrow="Your week"
          title={data.quietWeek ? 'A quiet week' : `${data.tasksApproved} ${data.tasksApproved === 1 ? 'task' : 'tasks'} done`}
          subtitle={data.quietWeek ? undefined : `${data.pointsEarned} points earned`}
        />

        {data.quietWeek ? (
          <EmptyState emoji="🌙" title="Nothing finished yet." message="There's always next week." />
        ) : (
          <>
            <View style={styles.statRow}>
              <StatTile label="Tasks done" value={data.tasksApproved} variant="success" />
              <StatTile label="Points earned" value={data.pointsEarned} variant="gold" />
            </View>
            <View style={styles.statRow}>
              <StatTile label="Points spent" value={data.pointsSpent} variant="peach" />
              <StatTile label="Games played" value={data.gamesPlayed} variant="xp" />
            </View>

            {best && bestDate && (
              <Highlight icon="star" tone="gold" title="Best day">
                <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                  {bestDate.toLocaleDateString(undefined, { weekday: 'long' })}: {best.tasksApproved}{' '}
                  {best.tasksApproved === 1 ? 'task' : 'tasks'}
                </AppText>
              </Highlight>
            )}

            <Highlight icon="flame" tone="peach" title="Streak">
              <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                {data.currentStreak} days now · {data.longestStreak} is your best
              </AppText>
            </Highlight>

            {data.achievementsUnlocked.length > 0 && (
              <Highlight icon="trophy" tone="gold" title="Unlocked this week">
                {data.achievementsUnlocked.map((a) => (
                  // Name only: `icon` here is `Achievement.iconUrl`, a real image URL rather than an
                  // emoji, so putting it in a Text node would print the URL.
                  <AppText key={a.name} style={[styles.body, { color: theme.mutedForeground }]}>
                    {a.name}
                  </AppText>
                ))}
              </Highlight>
            )}

            {data.teamUpsCompleted > 0 && (
              <Highlight icon="people" tone="primary" title="Team-ups">
                <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                  You worked together on {data.teamUpsCompleted}{' '}
                  {data.teamUpsCompleted === 1 ? 'task' : 'tasks'}.
                </AppText>
              </Highlight>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  statRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[2] },
  highlight: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  grow: { flex: 1 },
  footer: { marginTop: spacing[4] },
});
