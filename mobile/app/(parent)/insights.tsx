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
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { GradientHeader } from '@/components/GradientHeader';
import { Screen } from '@/components/Screen';
import { SectionTitle } from '@/components/SectionTitle';
import { SegmentedControl } from '@/components/SegmentedControl';
import { StatTile } from '@/components/StatTile';
import { NetworkError } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { insightsQuery } from '@/lib/familyApi';
import { plural } from '@/lib/plural';
import { fontSize, fontWeight, palette, radius, spacing, useTheme } from '@/theme';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const RANGES = [
  { key: '4', label: '4 weeks' },
  { key: '12', label: '12 weeks' },
  { key: '26', label: '26 weeks' },
] as const;

/**
 * A labelled horizontal bar.
 *
 * Width is a percentage of the row's own max, so a quiet week still reads as a shape rather than a
 * row of slivers. The value is printed as well as drawn: a bar chart with no numbers is decoration,
 * and it is the only thing a screen reader can convey. `color` is a fixed palette step per chart, so
 * the two charts on this screen read as different questions.
 */
function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const theme = useTheme();
  const width = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;

  return (
    <View style={styles.barRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText style={[styles.barLabel, { color: theme.mutedForeground }]}>{label}</AppText>
      <View style={[styles.barTrack, { backgroundColor: theme.muted }]}>
        <View style={[styles.barFill, { backgroundColor: color, width: `${width}%` }]} />
      </View>
      <AppText style={[styles.barValue, { color: theme.cardForeground }]}>{value}</AppText>
    </View>
  );
}

export default function Insights() {
  const theme = useTheme();
  const [weeks, setWeeks] = useState(12);
  const { data, error, isPending, isError, refetch } = useQuery(insightsQuery(weeks));

  const range = (
    <SegmentedControl
      options={RANGES.map((r) => ({ key: r.key, label: r.label }))}
      value={String(weeks) as (typeof RANGES)[number]['key']}
      onChange={(next) => setWeeks(Number(next))}
    />
  );

  if (isPending) {
    return (
      <Screen>
        <BackLink label="Back to home" href="/(parent)/dashboard" />
        <GradientHeader tone="brand" icon="stats-chart" eyebrow="Insights" title="Loading…" />
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <BackLink label="Back to home" href="/(parent)/dashboard" />
        <Callout kind="danger" title={offline ? 'No connection' : 'Could not load insights'} live>
          {describeError(error)}
        </Callout>
        <Button label="Try again" onPress={() => void refetch()} />
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
        <BackLink label="Back to home" href="/(parent)/dashboard" />
        <GradientHeader
          tone="brand"
          icon="stats-chart"
          eyebrow="Insights"
          title={`${plural(data.totals.approved, 'task')} approved`}
          subtitle={`Last ${plural(data.window.weeks, 'week')}, on ${plural(data.totals.activeDays, 'day')}`}
        />

        {range}

        <SectionTitle title="Points" icon="star" tone="gold" />
        <View style={styles.statRow}>
          <StatTile value={data.economy.pointsEarned} label="Earned" variant="gold" />
          <StatTile value={data.economy.pointsSpent} label="Spent" variant="peach" />
          <StatTile value={data.economy.currentBalance} label="Held" variant="success" />
        </View>
        {/* null, not Infinity: see the module note. */}
        {data.economy.inflationWarning ? (
          <Callout
            kind="warning"
            title={
              data.economy.earnSpendRatio === null
                ? undefined
                : `Earning ${data.economy.earnSpendRatio.toFixed(1)}× what they spend`
            }
          >
            {data.economy.inflationWarning}
          </Callout>
        ) : (
          <Callout kind="info" icon="analytics">
            {data.economy.earnSpendRatio === null
              ? 'Nothing spent yet, so there is no ratio to show.'
              : `Earning ${data.economy.earnSpendRatio.toFixed(1)}× what they spend.`}
          </Callout>
        )}

        <SectionTitle title="Best days" icon="calendar" tone="xp" />
        <Card>
          {data.byDayOfWeek.map((count, index) => (
            <Bar key={DAY_LABELS[index]} label={DAY_LABELS[index]} value={count} max={maxDay} color={palette.xp[500]} />
          ))}
        </Card>

        <SectionTitle title="Busiest times" icon="time" tone="primary" hint="Times are UTC" />
        <Card>
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
                color={palette.primary[500]}
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
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  statRow: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[2] },
  barLabel: { fontSize: fontSize.xs.fontSize, width: 44, fontWeight: fontWeight.semibold },
  barTrack: { flex: 1, height: spacing[3], borderRadius: radius.full, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: radius.full },
  barValue: { fontSize: fontSize.xs.fontSize, width: 32, textAlign: 'right', fontWeight: fontWeight.bold },
  footer: { height: spacing[8] },
});
