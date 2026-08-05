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
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { NetworkError } from '@/lib/api';
import { asDate } from '@/lib/dates';
import { describeError } from '@/lib/errors';
import { calendarQuery, type CalendarEntry } from '@/lib/familyApi';
import { plural } from '@/lib/plural';
import { fontSize, fontWeight, minTouchTarget, radius, spacing, useTheme } from '@/theme';

/** `YYYY-MM-DD` → "Mon 4". Parsed as UTC because that is what the server emits. */
function dayChipLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })} ${date.getUTCDate()}`;
}

function timeLabel(entry: CalendarEntry): string | null {
  if (!entry.isTimed) return null;
  const at = asDate(entry.startTime);
  if (!at) return null;
  return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

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
            {offline ? 'No connection' : 'Could not load the calendar'}
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

  return (
    <Screen>
      <ScrollView>
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          This week
        </AppText>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Same pair of properties as the task chips: without both, a horizontal ScrollView's
          // children stretch to its height and render as full-height columns.
          style={styles.chipScroller}
          contentContainerStyle={styles.chipRow}
        >
          {data.dates.map((date) => {
            const on = date === activeDate;
            const count = data.children.reduce(
              (sum, child) =>
                sum + (child.days.find((d) => d.date === date)?.entries.length ?? 0),
              0
            );
            return (
              <Pressable
                key={date}
                onPress={() => setSelected(date)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${dayChipLabel(date)}, ${plural(count, 'task')}`}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? theme.primary : theme.card,
                    borderColor: on ? theme.primary : theme.border,
                  },
                ]}
              >
                <AppText
                  style={[
                    styles.chipLabel,
                    { color: on ? theme.primaryForeground : theme.cardForeground },
                  ]}
                >
                  {dayChipLabel(date)}
                  {count > 0 ? ` · ${count}` : ''}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        {data.children.length === 0 && (
          <Card>
            <AppText style={[styles.body, { color: theme.cardForeground }]}>
              No children yet.
            </AppText>
          </Card>
        )}

        {data.children.map((child) => {
          const day = child.days.find((d) => d.date === activeDate);
          const entries = day?.entries ?? [];
          return (
            <Card key={child.childId}>
              <AppText style={[styles.title, { color: theme.cardForeground }]}>
                {child.firstName}
              </AppText>
              {entries.length === 0 ? (
                <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                  Nothing on this day.
                </AppText>
              ) : (
                entries.map((entry) => {
                  const at = timeLabel(entry);
                  return (
                    <View
                      key={entry.assignmentId}
                      style={[styles.entry, { borderTopColor: theme.border }]}
                    >
                      <AppText style={[styles.entryTitle, { color: theme.cardForeground }]}>
                        {entry.title}
                      </AppText>
                      <AppText style={[styles.body, { color: theme.mutedForeground }]}>
                        {/* No invented time for an untimed entry — see the module note. */}
                        {[at ?? 'Any time', `${entry.pointsValue} pts`, entry.status]
                          .filter(Boolean)
                          .join(' · ')}
                      </AppText>
                      {entry.overlaps && (
                        <AppText style={[styles.warning, { color: theme.destructive }]}>
                          Clashes with another task at the same time.
                        </AppText>
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
  heading: {
    fontSize: fontSize['2xl'].fontSize,
    lineHeight: fontSize['2xl'].lineHeight,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[3],
  },
  chipScroller: { flexGrow: 0, marginBottom: spacing[3] },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  chip: {
    paddingHorizontal: spacing[3],
    minHeight: minTouchTarget,
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipLabel: { fontSize: fontSize.sm.fontSize, fontWeight: fontWeight.medium },
  title: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.semibold,
  },
  body: { fontSize: fontSize.sm.fontSize, lineHeight: fontSize.sm.lineHeight, marginTop: spacing[1] },
  warning: {
    fontSize: fontSize.sm.fontSize,
    lineHeight: fontSize.sm.lineHeight,
    fontWeight: fontWeight.semibold,
    marginTop: spacing[1],
  },
  entry: { borderTopWidth: 1, paddingTop: spacing[3], marginTop: spacing[3] },
  entryTitle: {
    fontSize: fontSize.base.fontSize,
    lineHeight: fontSize.base.lineHeight,
    fontWeight: fontWeight.medium,
  },
  action: { marginTop: spacing[4] },
  footer: { height: spacing[8] },
});
