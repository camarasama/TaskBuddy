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
 *
 * ## Dates are picked, not typed
 *
 * The range used to be two text boxes asking for YYYY-MM-DD, which a phone keyboard makes miserable
 * and which invited a malformed value. `DateField` hands back exactly that format from a picker, so
 * the backend receives the same string it always did and the format check is no longer needed.
 *
 * Reached from the Reports tile on the parent Home screen. Before that tile existed nothing in the app
 * linked here.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { ChoicePills } from '@/components/ChoicePills';
import { DateField } from '@/components/DateField';
import { FormFooter } from '@/components/FormFooter';
import { FormSection } from '@/components/FormSection';
import { GradientHeader } from '@/components/GradientHeader';
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
import { spacing } from '@/theme';

/** Sentinel for "no child filter", since a pill needs a concrete value. Never sent to the server. */
const ALL_CHILDREN = '__all__';

export default function Reports() {
  const toast = useToast();

  const [report, setReport] = useState<ReportName>('task-completion');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [childId, setChildId] = useState<string | undefined>(undefined);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [period, setPeriod] = useState<LeaderboardPeriod>('weekly');
  const [busy, setBusy] = useState(false);

  // Not the reason this screen exists (it exists to download, not to browse), but a parent picking
  // a report about one child needs to see names, not paste an id. Errors here are swallowed to "no
  // children found" rather than a card, which would crowd out the download flow this screen is for.
  const { data: children } = useQuery(childrenQuery());

  const isLeaderboard = report === 'leaderboard';

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
    <Screen
      footer={
        <FormFooter>
          <Button
            label={busy ? 'Downloading…' : `Download ${format.toUpperCase()}`}
            onPress={() => void handleDownload()}
            busy={busy}
            disabled={busy}
          />
        </FormFooter>
      }
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <BackLink label="Back to home" href="/(parent)/dashboard" />
        <GradientHeader
          tone="brand"
          icon="document-text"
          eyebrow="Reports"
          title="Download a report"
          subtitle="Pick a report and a format. Viewing reports in detail is on the web."
        />

        <FormSection title="Report" icon="document-text" tone="xp">
          <ChoicePills
            label="Report"
            options={EXPORTABLE_REPORTS.map((option) => ({ value: option.name, label: option.label }))}
            value={report}
            onChange={setReport}
          />
        </FormSection>

        <FormSection title="Format and child" icon="download" tone="primary">
          <ChoicePills
            label="Format"
            options={[
              { value: 'csv' as const, label: 'CSV', icon: 'grid' },
              { value: 'pdf' as const, label: 'PDF', icon: 'document' },
            ]}
            value={format}
            onChange={setFormat}
          />
          <View style={styles.gap} />
          <ChoicePills
            label="Child"
            options={[
              { value: ALL_CHILDREN, label: 'All children', icon: 'people' },
              ...(children ?? []).map((child) => ({ value: child.id, label: `${child.firstName} ${child.lastName}` })),
            ]}
            value={childId ?? ALL_CHILDREN}
            onChange={(next) => setChildId(next === ALL_CHILDREN ? undefined : next)}
          />
        </FormSection>

        {isLeaderboard ? (
          <FormSection title="Period" icon="podium" tone="gold">
            <ChoicePills
              label="Period"
              options={LEADERBOARD_PERIODS.map((option) => ({ value: option.value, label: option.label }))}
              value={period}
              onChange={setPeriod}
            />
          </FormSection>
        ) : (
          <FormSection title="Date range" icon="calendar" tone="primary" hint="Optional. Leave blank for everything on record.">
            <View style={styles.pair}>
              <View style={styles.grow}>
                <DateField label="From" value={startDate} onChange={setStartDate} maximumDate={endDate ? new Date(`${endDate}T00:00:00`) : new Date()} />
              </View>
              <View style={styles.grow}>
                <DateField
                  label="Until"
                  value={endDate}
                  onChange={setEndDate}
                  minimumDate={startDate ? new Date(`${startDate}T00:00:00`) : undefined}
                  maximumDate={new Date()}
                />
              </View>
            </View>
            {/* A picked date cannot be un-picked from the picker itself, so blank has its own way back. */}
            {(startDate !== '' || endDate !== '') && (
              <Button
                label="Clear dates"
                variant="soft"
                onPress={() => {
                  setStartDate('');
                  setEndDate('');
                }}
              />
            )}
          </FormSection>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { height: spacing[4] },
  pair: { flexDirection: 'row', gap: spacing[2] },
  grow: { flex: 1 },
});
