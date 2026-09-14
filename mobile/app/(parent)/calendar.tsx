/**
 * The week's tasks, per child.
 *
 * A phone is too narrow for the web's grid of seven columns, so this inverts it: pick a day, see
 * every child's tasks for that day. Same data, a shape that fits.
 *
 * ## `isTimed` is honoured, not worked around
 *
 * Most assignments have no start time. The server sets `isTimed: false` for those and the comment on
 * the type says it plainly — **a calendar must not invent one**. So untimed entries are listed under
 * the day without a clock reading, rather than being dropped or defaulted to midnight, either of
 * which would misrepresent them.
 *
 * ## Overlaps are surfaced
 *
 * `overlaps` is computed server-side for entries whose windows collide for the same child on the
 * same day. It is the one thing a week view can tell a parent that a list cannot, so it is called
 * out in words rather than left to be inferred from two adjacent rows.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Callout } from '@/components/Callout';
import { Card } from '@/components/Card';
import { Chip, type ChipVariant } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { GradientHeader } from '@/components/GradientHeader';
import type { IoniconName } from '@/components/IconTile';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { calendarQuery, type CalendarEntry } from '@/lib/familyApi';
import { plural } from '@/lib/plural';
import { elevation, fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

/** `YYYY-MM-DD` → "Mon 4". Parsed as UTC because that is what the server emits. */
function dayChipLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })} ${date.getUTCDate()}`;
}

/** `YYYY-MM-DD` → weekday and day number separately, for the stacked day tile. */
function dayParts(iso: string): { weekday: string; day: string } {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { weekday: '', day: iso };
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
    day: String(date.getUTCDate()),
  };
}

function timeLabel(entry: CalendarEntry): string | null {
  if (!entry.isTimed) return null;
  const at = asDate(entry.startTime);
  if (!at) return null;
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** An entry's status as a pill in words. Unknown statuses fall back to their raw value, muted. */
const STATUS: Record<string, { label: string; variant: ChipVariant; icon: IoniconName }> = {
  pending: { label: 'To do', variant: 'info', icon: 'ellipse-outline' },
  in_progress: { label: 'Started', variant: 'info', icon: 'play' },
  completed: { label: 'Waiting', variant: 'pending', icon: 'hourglass' },
  approved: { label: 'Approved', variant: 'done', icon: 'checkmark-circle' },
  rejected: { label: 'Sent back', variant: 'late', icon: 'arrow-undo' },
  expired: { label: 'Missed', variant: 'late', icon: 'time' },
};

export default function Calendar() {
  const theme = useTheme();
  const { data, error, isPending, isError, refetch } = useQuery(calendarQuery());
  const [selected, setSelected] = useState<string | null>(null);

  /** Today when it falls in the returned week, otherwise the first day of it. */
  const activeDate = useMemo(() => {
    if (selected) return selected;
    if (!data) return null;
    const today = new Date().toISOString().slice(0, 10);
    return data.dates.includes(today) ? today : (data.dates[0] ?? null);
  }, [selected, data]);

  if (isPending) {
    return (
      <Screen>
        <BackLink label="Back to home" href="/(parent)/dashboard" />
        <GradientHeader tone="success" icon="calendar" eyebrow="This week" title="Loading…" />
      </Screen>
    );
  }

  if (isError) {
    const offline = error instanceof NetworkError;
    return (
      <Screen scroll>
        <BackLink label="Back to home" href="/(parent)/dashboard" />
        <Callout kind="danger" title={offline ? 'No connection' : 'Could not load the calendar'} live>
          {describeError(error)}
        </Callout>
        <Button label="Try again" onPress={() => void refetch()} />
      </Screen>
    );
  }

  const countFor = (date: string) =>
    data.children.reduce((sum, child) => sum + (child.days.find((d) => d.date === date)?.entries.length ?? 0), 0);
  const activeCount = activeDate ? countFor(activeDate) : 0;

  return (
    <Screen>
      <ScrollView>
        <BackLink label="Back to home" href="/(parent)/dashboard" />
        <GradientHeader
          tone="success"
          icon="calendar"
          eyebrow="This week"
          title={activeDate ? dayChipLabel(activeDate) : 'This week'}
          subtitle={`${plural(activeCount, 'task')} across ${plural(data.children.length, 'child', 'children')}`}
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Without both of these, a horizontal ScrollView's children stretch to its height and render
          // as full-height columns.
          style={styles.dayScroller}
          contentContainerStyle={styles.dayRow}
        >
          {data.dates.map((date) => {
            const on = date === activeDate;
            const count = countFor(date);
            const { weekday, day } = dayParts(date);
            return (
              <Pressable
                key={date}
                onPress={() => setSelected(date)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${dayChipLabel(date)}, ${plural(count, 'task')}`}
                style={[styles.day, elevation.card, { backgroundColor: on ? theme.primary : theme.card }]}
              >
                <AppText style={[styles.dayWeekday, { color: on ? theme.primaryForeground : theme.mutedForeground }]}>
                  {weekday}
                </AppText>
                <AppText variant="display" style={[styles.dayNumber, { color: on ? theme.primaryForeground : theme.cardForeground }]}>
                  {day}
                </AppText>
                <View style={[styles.dayCount, { backgroundColor: on ? theme.primaryForeground : theme.muted }]}>
                  <AppText style={[styles.dayCountLabel, { color: on ? theme.primary : theme.cardForeground }]}>{count}</AppText>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {data.children.length === 0 && <EmptyState emoji="👋" title="No children yet." />}

        {data.children.map((child) => {
          const day = child.days.find((d) => d.date === activeDate);
          const entries = day?.entries ?? [];
          return (
            <Card key={child.childId}>
              <View style={styles.childHead}>
                <Avatar seed={child.childId} name={child.firstName} size={40} />
                <AppText style={[styles.title, styles.grow, { color: theme.cardForeground }]}>{child.firstName}</AppText>
                <Chip compact variant="info" label={plural(entries.length, 'task')} />
              </View>
              {entries.length === 0 ? (
                <AppText style={[styles.body, { color: theme.mutedForeground }]}>Nothing on this day.</AppText>
              ) : (
                entries.map((entry) => {
                  const at = timeLabel(entry);
                  const status = STATUS[entry.status];
                  return (
                    <View key={entry.assignmentId} style={[styles.entry, { borderTopColor: theme.border }]}>
                      <View style={styles.entryRow}>
                        <View style={styles.grow}>
                          <AppText style={[styles.entryTitle, { color: theme.cardForeground }]}>{entry.title}</AppText>
                          <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                            {/* No invented time for an untimed entry: see the module note. */}
                            {[at ?? 'Any time', `${entry.pointsValue} pts`].join(' · ')}
                          </AppText>
                        </View>
                        {status ? (
                          <Chip compact variant={status.variant} icon={status.icon} label={status.label} />
                        ) : (
                          <Chip compact variant="info" label={entry.status} />
                        )}
                      </View>
                      {entry.overlaps && (
                        <View style={styles.clash}>
                          <Callout kind="warning" icon="alert-circle">
                            Clashes with another task at the same time.
                          </Callout>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </Card>
          );
        })}

        <View style={styles.footer} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dayScroller: { flexGrow: 0, marginBottom: spacing[4] },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[1] },
  day: {
    width: 60,
    minHeight: minTouchTarget,
    borderRadius: radius.lg,
    paddingVertical: spacing[2],
    alignItems: 'center',
    gap: spacing[1],
  },
  dayWeekday: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight, fontWeight: fontWeight.semibold },
  dayNumber: { fontSize: fontSize.lg.fontSize, lineHeight: fontSize.lg.lineHeight, fontWeight: fontWeight.bold },
  dayCount: { minWidth: 22, borderRadius: radius.full, paddingHorizontal: spacing[1], alignItems: 'center' },
  dayCountLabel: { fontSize: fontSize.xs.fontSize, lineHeight: fontSize.xs.lineHeight, fontWeight: fontWeight.bold },
  childHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  grow: { flex: 1 },
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  entry: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  entryTitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.medium,
  },
  clash: { marginTop: spacing[2], marginBottom: -spacing[4] },
  footer: { height: spacing[8] },
});
