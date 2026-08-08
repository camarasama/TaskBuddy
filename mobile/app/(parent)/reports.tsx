/**
 * Reports — pick filters, download a file. No viewer.
 *
 * That last sentence is a product decision, not an oversight: this screen exists to hand a parent a
 * CSV or PDF they can put wherever they want, not to render one. See `@/lib/reportsApi` for the full
 * reasoning. If a future change wants a chart or a table here, that is a different, larger decision
 * than this screen was built to make.
 *
 * ## Why the filter row changes shape for one report
 *
 * `leaderboard` is the one report the backend does not filter by date range at all — it reads
 * `period` (weekly/monthly/all-time) instead (`getLeaderboardReport` in reports.ts). Showing date
 * fields that report silently ignores would be a control that lies about what it does, so the period
 * picker replaces the date fields rather than sitting alongside them.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { describeError } from '@/lib/errors';
import { childrenQuery } from '@/lib/childrenApi';
import {
  downloadReport,
  EXPORTABLE_REPORTS,
  LEADERBOARD_PERIODS,
  type ExportFormat,
  type LeaderboardPeriod,
  type ReportName,
} from '@/lib/reportsApi';
import { fontSize, fontWeight, spacing, useTheme } from '@/theme';

/** `YYYY-MM-DD`, matching what the backend does with the query param: `new Date(value)`. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export default function Reports() {
  const theme = useTheme();
  const toast = useToast();

  const [report, setReport] = useState<ReportName>('task-completion');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [childId, setChildId] = useState<string | undefined>(undefined);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [period, setPeriod] = useState<LeaderboardPeriod>('weekly');
  const [busy, setBusy] = useState(false);

  // Not the reason this screen exists — it exists to download, not to browse — but a parent picking
  // a report about one child needs to see names, not paste an id. Errors here are swallowed to "no
  // children found" rather than a card, which would crowd out the download flow this screen is for.
  const { data: children } = useQuery(childrenQuery());

  const isLeaderboard = report === 'leaderboard';
  const startValid = startDate.length === 0 || DATE_PATTERN.test(startDate);
  const endValid = endDate.length === 0 || DATE_PATTERN.test(endDate);
  const canDownload = !busy && startValid && endValid;

  const handleDownload = async () => {
    setBusy(true);
    try {
      const result = await downloadReport(report, format, {
        childId,
        startDate: !isLeaderboard && startDate ? startDate : undefined,
        endDate: !isLeaderboard && endDate ? endDate : undefined,
        period: isLeaderboard ? period : undefined,
      });
      toast.show(`Saved ${result.filename}`, 'success');
    } catch (caught) {
      // A failed download must read as a failure, never a spinner that quietly stops. describeError
      // handles the ApiError/NetworkError/SessionExpiredError cases this can throw; anything else
      // (e.g. "Sharing is not available on this device") already carries its own readable message.
      toast.show(describeError(caught) || 'Could not download the report.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <AppText variant="display" style={[styles.heading, { color: theme.foreground }]}>
          Reports
        </AppText>
        <AppText style={[styles.body, { color: theme.mutedForeground }]}>
          Pick a report and a format, then download it. Viewing reports in detail is on the web.
        </AppText>

        <Card>
          <AppText style={[styles.title, { color: theme.cardForeground }]}>Report</AppText>
          <View style={styles.chipRow}>
            {EXPORTABLE_REPORTS.map((option) => (
              <Button
                key={option.name}
                label={option.label}
                variant={option.name === report ? 'primary' : 'secondary'}
                onPress={() => setReport(option.name)}
              />
            ))}
          </View>
        </Card>

        <Card>
          <AppText style={[styles.title, { color: theme.cardForeground }]}>Format</AppText>
          <View style={styles.chipRow}>
            <Button
              label="CSV"
              variant={format === 'csv' ? 'primary' : 'secondary'}
              onPress={() => setFormat('csv')}
            />
            <Button
              label="PDF"
              variant={format === 'pdf' ? 'primary' : 'secondary'}
              onPress={() => setFormat('pdf')}
            />
          </View>
        </Card>

        <Card>
          <AppText style={[styles.title, { color: theme.cardForeground }]}>Child</AppText>
          <View style={styles.chipRow}>
            <Button
              label="All children"
              variant={childId === undefined ? 'primary' : 'secondary'}
              onPress={() => setChildId(undefined)}
            />
            {(children ?? []).map((child) => (
              <Button
                key={child.id}
                label={`${child.firstName} ${child.lastName}`}
                variant={childId === child.id ? 'primary' : 'secondary'}
                onPress={() => setChildId(child.id)}
              />
            ))}
          </View>
        </Card>

        {isLeaderboard ? (
          <Card>
            <AppText style={[styles.title, { color: theme.cardForeground }]}>Period</AppText>
            <View style={styles.chipRow}>
              {LEADERBOARD_PERIODS.map((option) => (
                <Button
                  key={option.value}
                  label={option.label}
                  variant={option.value === period ? 'primary' : 'secondary'}
                  onPress={() => setPeriod(option.value)}
                />
              ))}
            </View>
          </Card>
        ) : (
          <Card>
            <AppText style={[styles.title, { color: theme.cardForeground }]}>Date range</AppText>
            <AppText style={[styles.body, { color: theme.mutedForeground }]}>
              Optional. Leave blank for everything on record.
            </AppText>
            <Field
              label="Start date"
              placeholder="YYYY-MM-DD"
              value={startDate}
              onChangeText={setStartDate}
              autoCapitalize="none"
              autoCorrect={false}
              hint={!startValid ? 'Use YYYY-MM-DD' : undefined}
            />
            <Field
              label="End date"
              placeholder="YYYY-MM-DD"
              value={endDate}
              onChangeText={setEndDate}
              autoCapitalize="none"
              autoCorrect={false}
              hint={!endValid ? 'Use YYYY-MM-DD' : undefined}
            />
          </Card>
        )}

        <View style={styles.action}>
          <Button
            label={busy ? 'Downloading…' : `Download ${format.toUpperCase()}`}
            onPress={() => void handleDownload()}
            busy={busy}
            disabled={!canDownload}
          />
        </View>

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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  action: { marginTop: spacing[2] },
  footer: { height: spacing[8] },
});
