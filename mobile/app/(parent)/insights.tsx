/**
 * Insights — when tasks actually get done, and whether the points economy is holding.
 *
 * ## Charts drawn from Views, deliberately, with no charting library
 *
 * The roadmap earmarked `victory-native` and flagged it as needing a spike: the current major is
 * Skia-based, which means a **native module**, a rebuild, and a large binary — on an app whose
 * audience is families with cheap Android phones. Against that, everything on this screen is a bar
 * of a known maximum. A `View` with a percentage width draws that exactly, costs nothing, needs no
 * build, and cannot break at an SDK bump.
 *
 * The moment this screen needs axes, curves or interaction, that trade flips and the library is
 * worth its weight. It does not need them today.
 *
 * ## Two things the data will not let us pretend
 *
 * `earnSpendRatio` is **null** when nothing has been spent — an infinity is not a ratio, and the
 * server is careful about it, so the screen says "nothing spent yet" rather than rendering `∞`.
 * And `byHourOfDay` is indexed in **UTC**, not the family's timezone; labelling those bars as local
 * hours would be quietly wrong for most of the world, so the heading says UTC.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { insightsQuery } from '@/lib/familyApi';
import { plural } from '@/lib/plural';
import { fontSize, fontWeight, radius, spacing, useTheme } from '@/theme';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * A labelled horizontal bar.
 *
 * Width is a percentage of the row's own max, so a quiet week still reads as a shape rather than a
 * row of slivers. The value is printed as well as drawn — a bar chart with no numbers is decoration,
 * and it is the only thing a screen reader can convey.
 */
function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const theme = useTheme();
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;

  return (
    <View style={styles.barRow} accessibilityLabel={`${label}: ${value}`}>
      <AppText style={[styles.barLabel, { color: theme.mutedForeground }]}>{label}</AppText>
      <View style={[styles.barTrack, { backgroundColor: theme.muted }]}>
        <View style={[styles.barFill, { backgroundColor: theme.primary, width: `${width}%` }]} />
      </View>
      <AppText style={[styles.barValue, { color: theme.cardForeground }]}>{value}</AppText>
    </View>
  );
}

export default function Insights() {
  const theme = useTheme();
  const [weeks, setWeeks] = useState(12);
  const { data, error, isPending, isError, refetch } = useQuery(insightsQuery(weeks));

  if (isPending) {
    return (
      <Screen>
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
        <Card>
          <AppText style={[styles.title, { color: theme.destructive }]}>
            {offline ? 'No connection' : 'Could not load insights'}
          </AppText>
          <AppText style={[styles.body, { color: theme.cardForeground }]}>
            {describeError(error)}
          </AppText>
        </Card>
        <View style={styles.action}>
          <Button label="Try again" onPress={() => void refetch()} />
        </View>
      </Screen>
    );
  }

  const maxDay = Math.max(...data.byDayOfWeek, 1);
  const maxHour = Math.max(...data.byHourOfDay, 1);

  // Only hours that ever saw a completion. Twenty-four rows on a phone, most of them zero, is a
  // scroll rather than a chart.
  const busyHours = data.byHourOfDay
    .map((count, hour) => ({ hour, count }))
    .filter((h) => h.count > 0);

  return (
    <Screen>
      <ScrollView>
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          Insights
        </AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Last {plural(data.window.weeks, 'week')} · {plural(data.totals.approved, 'task')} approved
          on {plural(data.totals.activeDays, 'day')}
        </AppText>

        <View style={styles.chipRow}>
          {[4, 12, 26].map((option) => (
            <Button
              key={option}
              label={`${option}w`}
              variant={option === weeks ? 'primary' : 'secondary'}
              onPress={() => setWeeks(option)}
            />
          ))}
        </View>

        <Card>
          <AppText style={[styles.title, { color: theme.cardForeground }]}>Points</AppText>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>
            {data.economy.pointsEarned} earned · {data.economy.pointsSpent} spent ·{' '}
            {data.economy.currentBalance} held
          </AppText>
          <AppText style={[styles.body, { color: theme.mutedForeground }]}>
            {/* null, not Infinity — see the module note. */}
            {data.economy.earnSpendRatio === null
              ? 'Nothing spent yet, so there is no ratio to show.'
              : `Earning ${data.economy.earnSpendRatio.toFixed(1)}× what they spend.`}
          </AppText>
          {data.economy.inflationWarning && (
            <AppText style={[styles.warning, { color: theme.destructive }]}>
              {data.economy.inflationWarning}
            </AppText>
          )}
        </Card>

        <Card>
          <AppText style={[styles.title, { color: theme.cardForeground }]}>Best days</AppText>
          {data.byDayOfWeek.map((count, index) => (
            <Bar key={DAY_LABELS[index]} label={DAY_LABELS[index]} value={count} max={maxDay} />
          ))}
        </Card>

        <Card>
          <AppText style={[styles.title, { color: theme.cardForeground }]}>
            Busiest times (UTC)
          </AppText>
          {busyHours.length === 0 ? (
            <AppText style={[styles.body, { color: theme.mutedForeground }]}>
              Nothing finished yet in this window.
            </AppText>
          ) : (
            busyHours.map(({ hour, count }) => (
              <Bar
                key={hour}
                label={`${String(hour).padStart(2, '0')}:00`}
                value={count}
                max={maxHour}
              />
            ))
          )}
        </Card>

        <View style={styles.footer} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
  },
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing[2],
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  warning: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
    marginTop: spacing[2],
  },
  chipRow: { flexDirection: 'row', gap: spacing[2], marginVertical: spacing[3] },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[2] },
  barLabel: { fontSize: fontSize.xs.fontSize, width: 44 },
  barTrack: { flex: 1, height: spacing[3], borderRadius: radius.full, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.full },
  barValue: { fontSize: fontSize.xs.fontSize, width: 32, textAlign: 'right' },
  action: { marginTop: spacing[4] },
  footer: { height: spacing[8] },
});
