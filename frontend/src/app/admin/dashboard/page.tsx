/**
 * app/admin/dashboard/page.tsx - admin Overview (redesigned 2026-10-26).
 *
 * The holistic view of the app: size (families, parents, children), usage (active families, daily
 * and weekly), activation, churn, lifecycle stages, retention by signup week, feature adoption,
 * platform health, and the families that need a nudge. Data: GET /admin/insights/overview and
 * /admin/insights/nudges. Test accounts are excluded unless "Include testers" is on.
 */

'use client';

import { useEffect, useState } from 'react';
import { adminInsightsApi, STAGE_INFO, type InsightsOverview, type InsightsRange, type Stage } from '@/lib/adminInsightsApi';
import {
  Card,
  CardHeader,
  Delta,
  ErrorBlock,
  fmtPct,
  INK2,
  KpiTile,
  LoadingBlock,
  Meter,
  PageShell,
  PageTitle,
  Segmented,
  StatusPill,
  TONE,
  type Tone,
} from '@/components/admin/insights/ui';
import { ActiveFamiliesChart, CohortGrid, SignupsChart } from '@/components/admin/insights/charts';
import { NudgeTable } from '@/components/admin/insights/NudgeTable';

const RANGES: Array<{ value: InsightsRange; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '12m', label: '12 months' },
];

const STAGE_COLOR: Record<Stage, string> = {
  new: '#A9C9F0',
  engaged: '#2a78d6',
  at_risk: '#E0A040',
  dormant: '#D9822B',
  one_and_done: '#C4502E',
  churned: '#8E8E93',
};
const STAGE_FLAG: Partial<Record<Stage, { tone: 'warn' | 'bad'; text: string }>> = {
  at_risk: { tone: 'warn', text: 'Watch' },
  dormant: { tone: 'warn', text: 'In sequence' },
  one_and_done: { tone: 'bad', text: 'In sequence' },
};

function pointsDelta(now: number | null, prev: number | null, lowerIsBetter = false): { text: string; tone: Tone; direction?: 'up' | 'down' } | null {
  if (now == null || prev == null) return null;
  const d = Math.round((now - prev) * 10) / 10;
  if (d === 0) return { text: 'No change', tone: 'neutral' };
  const good = lowerIsBetter ? d < 0 : d > 0;
  return { text: `${d > 0 ? '+' : ''}${d} pts vs previous`, tone: good ? 'good' : 'bad', direction: d > 0 ? 'up' : 'down' };
}

function n(v: number): string {
  return v.toLocaleString('en-GB');
}

export default function AdminOverviewPage() {
  const [range, setRange] = useState<InsightsRange>('30d');
  const [includeTesters, setIncludeTesters] = useState(false);
  const [data, setData] = useState<InsightsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    adminInsightsApi
      .overview(range, includeTesters)
      .then((res) => { if (live) { setData(res.data ?? null); setError(null); } })
      .catch(() => { if (live) setError('Could not load the overview. Please refresh.'); });
    return () => { live = false; };
  }, [range, includeTesters]);

  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? '';
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <PageShell>
      <PageTitle
        eyebrow={today}
        title="Overview"
        right={
          <>
            <Segmented label="Time range" options={RANGES} value={range} onChange={setRange} />
            <label className={`flex items-center gap-2 text-[13px] ${INK2}`}>
              Include testers{data ? ` (${data.testFamilies})` : ''}
              <input
                type="checkbox"
                checked={includeTesters}
                onChange={(e) => setIncludeTesters(e.target.checked)}
                className="w-[18px] h-[18px] accent-[#0066CC]"
              />
            </label>
          </>
        }
      />

      {error && <ErrorBlock message={error} />}
      {!data && !error && <LoadingBlock />}

      {data && (
        <>
          <section aria-label="Key numbers" className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
            <KpiTile
              label="Families"
              value={n(data.kpis.families.value)}
              delta={<Delta text={`+${data.kpis.families.newInRange} in ${rangeLabel}`} tone={data.kpis.families.newInRange > 0 ? 'good' : 'neutral'} direction={data.kpis.families.newInRange > 0 ? 'up' : undefined} />}
              note={`${data.kpis.families.newPrevRange} in the ${rangeLabel} before`}
            />
            <KpiTile
              label="Parents"
              value={n(data.kpis.parents.value)}
              note={`${data.kpis.parents.perFamily ?? 0} per family · ${fmtPct(data.kpis.parents.coParentShare)} have a co-parent`}
            />
            <KpiTile
              label="Children"
              value={n(data.kpis.children.value)}
              note={`${data.kpis.children.perFamily ?? 0} per family · ${n(data.kpis.children.activeLast7d)} active this week`}
            />
            <KpiTile
              label="Weekly active families"
              value={fmtPct(data.kpis.weeklyActive.pct)}
              note={`${n(data.kpis.weeklyActive.value)} of ${n(data.kpis.families.value)} families`}
            />
            <KpiTile
              label="Activation rate"
              value={fmtPct(data.kpis.activation.rate)}
              delta={(() => { const d = pointsDelta(data.kpis.activation.rate, data.kpis.activation.prevRate); return d && <Delta {...d} />; })()}
              note={`Task approved within 7 days of signup · ${data.kpis.activation.cohort} families`}
            />
            <KpiTile
              label="30-day churn"
              value={fmtPct(data.kpis.churn30d.rate)}
              delta={(() => { const d = pointsDelta(data.kpis.churn30d.rate, data.kpis.churn30d.prevRate, true); return d && <Delta {...d} />; })()}
              note="Active last month, silent this month"
            />
          </section>

          <section className="flex flex-wrap gap-4">
            <Card className="flex-[2_1_560px]">
              <CardHeader
                title="Active families"
                subtitle="A family is active on a day when any parent or child uses the app."
              />
              <ActiveFamiliesChart activity={data.activity} />
            </Card>
            <Card className="flex-[1_1_300px]">
              <CardHeader title="Engagement" />
              <dl className="flex flex-col">
                {[
                  { label: 'Stickiness (daily ÷ monthly active)', value: fmtPct(data.engagement.stickiness), note: `Of ${n(data.engagement.monthlyActiveFamilies)} families active this month` },
                  { label: 'Tasks approved per active family', value: data.engagement.tasksApprovedPerActiveFamilyPerWeek == null ? 'No data' : `${data.engagement.tasksApprovedPerActiveFamilyPerWeek} / week`, note: 'Average, last 4 weeks' },
                  { label: 'Time to approve a submitted task', value: data.engagement.medianApprovalHours == null ? 'No data' : `${data.engagement.medianApprovalHours} h`, note: `Median, last ${rangeLabel}. Slow approval predicts churn` },
                  { label: 'Children active this week', value: n(data.kpis.children.activeLast7d), note: `Of ${n(data.kpis.children.value)} children` },
                ].map((e) => (
                  <div key={e.label} className="py-3 border-b border-[#F0F0F3] last:border-0">
                    <dt className={`text-[13px] ${INK2}`}>{e.label}</dt>
                    <dd className="text-2xl font-bold tracking-tight">{e.value}</dd>
                    <dd className={`text-xs ${INK2}`}>{e.note}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </section>

          <section className="flex flex-wrap gap-4">
            <Card className="flex-[1_1_340px]">
              <CardHeader title="Family lifecycle" subtitle={`Every family sits in exactly one stage. ${n(data.kpis.families.value)} families in total.`} />
              <div className="flex flex-col gap-3.5">
                {(Object.keys(STAGE_INFO) as Stage[]).map((s) => {
                  const count = data.lifecycle[s] ?? 0;
                  const share = data.kpis.families.value ? (count / data.kpis.families.value) * 100 : 0;
                  const flag = STAGE_FLAG[s];
                  return (
                    <div key={s} className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-baseline gap-2 text-sm">
                        <span className="flex items-center gap-2 font-medium">
                          {STAGE_INFO[s].label}
                          {flag && count > 0 && <StatusPill tone={flag.tone}>{flag.text}</StatusPill>}
                        </span>
                        <span className="tabular-nums font-semibold">
                          {n(count)} <span className={`font-normal ${INK2}`}>· {Math.round(share)}%</span>
                        </span>
                      </div>
                      <Meter pct={share} color={STAGE_COLOR[s]} />
                      <span className={`text-xs ${INK2}`}>{STAGE_INFO[s].rule}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="flex-[1_1_340px]">
              <CardHeader title="New families per week" subtitle="Signups in the last 8 weeks, and how many activated within 7 days." />
              <SignupsChart weeks={data.weeklySignups} />
            </Card>
          </section>

          <NudgeTable />

          <section className="flex flex-wrap gap-4">
            <Card className="flex-[2_1_560px]">
              <CardHeader title="Weekly retention by signup cohort" subtitle="Share of each week's new families still active N weeks later. Darker is better." />
              <CohortGrid cohorts={data.cohorts} />
            </Card>
            <Card className="flex-[1_1_300px]">
              <CardHeader title="Feature adoption" subtitle={`Share of the ${n(data.adoption.activeFamilies)} families active in the last ${rangeLabel}.`} />
              <div className="flex flex-col gap-3">
                {data.adoption.features.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1">
                    <div className="flex justify-between text-[13px]">
                      <span>{f.label}</span>
                      <span className="font-semibold tabular-nums">{fmtPct(f.pct)}</span>
                    </div>
                    <Meter pct={f.pct ?? 0} height={6} />
                  </div>
                ))}
              </div>
            </Card>
          </section>

          <section aria-label="Platform health" className="flex flex-col gap-3">
            <h2 className="text-[19px] font-semibold">Platform health</h2>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
              {[
                {
                  label: 'Email delivery rate',
                  value: fmtPct(data.health.emailDeliveryRate),
                  ok: data.health.emailDeliveryRate == null || data.health.emailDeliveryRate >= 97,
                  note: `${data.health.emailsFailed} failed in ${rangeLabel}`,
                },
                {
                  label: 'Server load now',
                  value: `${data.health.serverLoadPct}%`,
                  ok: data.health.serverLoadPct < 70,
                  note: `Up ${data.health.uptimeHours} h · ${data.health.memoryMb} MB memory`,
                },
                {
                  label: 'Tasks waiting for approval',
                  value: n(data.health.pendingApprovals),
                  ok: true,
                  note: 'Across all families',
                },
              ].map((h) => (
                <div key={h.label} className="bg-white rounded-[18px] px-5 py-[18px] flex flex-col gap-1.5">
                  <span className={`text-[13px] font-medium ${INK2}`}>{h.label}</span>
                  <span className="text-[26px] font-bold tracking-tight">{h.value}</span>
                  <span className={`text-xs font-semibold ${h.ok ? TONE.good : TONE.warn}`}>{h.ok ? 'Healthy' : 'Needs a look'}</span>
                  <span className={`text-xs ${INK2}`}>{h.note}</span>
                </div>
              ))}
              <a
                href="https://de.sentry.io/"
                target="_blank"
                rel="noreferrer"
                className="bg-white rounded-[18px] px-5 py-[18px] flex flex-col gap-1.5 hover:bg-[#FBFBFD]"
              >
                <span className={`text-[13px] font-medium ${INK2}`}>Crashes and errors</span>
                <span className="text-[17px] font-semibold text-[#0066CC]">Open Sentry</span>
                <span className={`text-xs ${INK2}`}>Crash-free users and error trends for web and Android</span>
              </a>
            </div>
          </section>
        </>
      )}
    </PageShell>
  );
}
