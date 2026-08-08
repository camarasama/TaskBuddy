/**
 * Weekly recap.
 *
 * The one place the app looks back rather than forward.
 *
 * `quietWeek` is honoured literally: when the server says nothing happened, this says nothing happened.
 * The temptation is to fill the space with encouragement, and a child who did nothing all week knows
 * they did nothing — manufactured praise for it is the fastest way to make every other message on the
 * screen untrustworthy.
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { recapQuery } from '@/lib/childProfileApi';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

function Stat({ label, value }: { label: string; value: number | string }) {
  const theme = useTheme();
  return (
    <View style={styles.stat}>
      <AppText style={[styles.statValue, { color: theme.foreground }]}>{value}</AppText>
      <AppText style={[styles.statLabel, { color: theme.mutedForeground }]}>{label}</AppText>
    </View>
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
        <Card>
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
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          Your week
        </AppText>

        {data.quietWeek ? (
          <Card>
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              A quiet week — nothing finished yet. There&apos;s always next week.
            </AppText>
          </Card>
        ) : (
          <>
            <Card>
              <View style={styles.statRow}>
                <Stat label="Tasks done" value={data.tasksApproved} />
                <Stat label="Points earned" value={data.pointsEarned} />
                <Stat label="Points spent" value={data.pointsSpent} />
                <Stat label="Games played" value={data.gamesPlayed} />
              </View>
            </Card>

            {best && bestDate && (
              <Card>
                <AppText style={[styles.title, { color: theme.cardForeground }]}>Best day</AppText>
                <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                  {bestDate.toLocaleDateString(undefined, { weekday: 'long' })} — {best.tasksApproved}{' '}
                  {best.tasksApproved === 1 ? 'task' : 'tasks'}
                </AppText>
              </Card>
            )}

            <Card>
              <AppText style={[styles.title, { color: theme.cardForeground }]}>Streak</AppText>
              <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                {data.currentStreak} days now · {data.longestStreak} is your best
              </AppText>
            </Card>

            {data.achievementsUnlocked.length > 0 && (
              <Card>
                <AppText style={[styles.title, { color: theme.cardForeground }]}>
                  Unlocked this week
                </AppText>
                {data.achievementsUnlocked.map((a) => (
                  // Name only — `icon` here is `Achievement.iconUrl`, a real image URL rather than an
                  // emoji, so putting it in a Text node would print the URL.
                  <AppText key={a.name} style={[styles.body, { color: theme.mutedForeground }]}>
                    {a.name}
                  </AppText>
                ))}
              </Card>
            )}

            {data.teamUpsCompleted > 0 && (
              <Card>
                <AppText style={[styles.body, { color: theme.cardForeground }]}>
                  You worked together on {data.teamUpsCompleted}{' '}
                  {data.teamUpsCompleted === 1 ? 'task' : 'tasks'}.
                </AppText>
              </Card>
            )}
          </>
        )}
      </ScrollView>
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
    marginBottom: spacing[1],
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  statRow: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { width: '50%', paddingVertical: spacing[2], paddingRight: spacing[2] },
  statValue: {
    fontSize: fontSize.xl.fontSize,
    lineHeight: fontSize.xl.lineHeight,
    fontWeight: fontWeight.bold,
  },
  statLabel: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight },
  footer: { marginTop: spacing[4] },
});
