'use client';

/**
 * /admin/funnel — the activation funnel (growth roadmap §1, §5.5).
 *
 * The roadmap's KPIs "had nowhere to live": events have been written since the instrumentation
 * shipped and nothing anywhere could read them. This is where they land.
 *
 * Every figure here is deliberately capable of looking bad. A dashboard that cannot show a poor
 * number is decoration, so nulls render as "no data yet" rather than as zeroes, and families that
 * never activated stay in the denominator.
 */

import { useCallback, useEffect, useState } from 'react';
import { adminFunnelApi } from '@/lib/api';
import type { FunnelReport } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

const WINDOWS = [7, 30, 90] as const;

/** Order matters — it is the order a parent meets them in the wizard. */
const STEP_LABELS: Record<string, string> = {
  child: 'Added a child',
  tasks: 'Picked a starter pack',
  reward: 'Added a reward',
  handoff: 'Tried it together',
};
const STEP_ORDER = ['child', 'tasks', 'reward', 'handoff'];

export default function AdminFunnelPage() {
  const { error: showError } = useToast();
  const [days, setDays] = useState<number>(30);
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (window: number) => {
      setLoading(true);
      try {
        const res = await adminFunnelApi.get(window);
        setFunnel((res.data as { funnel: FunnelReport }).funnel);
      } catch {
        showError('Failed to load the funnel');
      } finally {
        setLoading(false);
      }
    },
    [showError],
  );

  useEffect(() => {
    void load(days);
  }, [days, load]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Activation funnel</h2>
          <p className="text-slate-500 text-sm mt-1">
            Signup → first approved task. The north star is families with at least one approved task
            per week.
          </p>
        </div>
        <div className="flex gap-2">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                days === w ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-7 w-20 bg-slate-100 rounded mb-2" />
              <div className="h-4 w-28 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : !funnel ? null : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Signups" value={funnel.signups} hint="Families registered in this window" />
            <Stat
              label="Activated"
              value={funnel.activated}
              hint="Reached a first approved task"
            />
            <Stat
              label="Activation rate"
              value={funnel.activationRate === null ? null : `${funnel.activationRate}%`}
              hint="Of the families that signed up in this window"
            />
            <Stat
              label="Time to first approval"
              value={
                funnel.medianHoursToFirstApproval === null
                  ? null
                  : formatHours(funnel.medianHoursToFirstApproval)
              }
              hint="Median. Target: under 48h"
              good={
                funnel.medianHoursToFirstApproval !== null &&
                funnel.medianHoursToFirstApproval <= 48
              }
            />
          </div>

          <section className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-800 mb-1">Setup completion</h3>
            <p className="text-xs text-slate-500 mb-4">
              Distinct families reaching each step. Where the biggest drop is, is where to look.
            </p>

            {funnel.setupSteps.length === 0 ? (
              <p className="text-sm text-slate-400">No setup activity in this window.</p>
            ) : (
              <div className="space-y-3">
                {STEP_ORDER.map((step) => {
                  const row = funnel.setupSteps.find((s) => s.step === step);
                  const count = row?.families ?? 0;
                  // Proportion of signups, so the bars show drop-off rather than raw volume.
                  const pct = funnel.signups > 0 ? Math.round((count / funnel.signups) * 100) : 0;
                  return (
                    <div key={step}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-700">{STEP_LABELS[step] ?? step}</span>
                        <span className="text-slate-500">
                          {count}
                          {funnel.signups > 0 && <span className="text-slate-400"> · {pct}%</span>}
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-semibold text-slate-800 mb-4">Weekly digest</h3>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Sent" value={funnel.digestsSent} compact />
              <Stat label="Opened" value={funnel.digestsOpened} compact />
              <Stat
                label="Open rate"
                value={funnel.digestOpenRate === null ? null : `${funnel.digestOpenRate}%`}
                hint="Target: over 45%"
                good={funnel.digestOpenRate !== null && funnel.digestOpenRate >= 45}
                compact
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** Turns hours into something a person reads without doing arithmetic. */
function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function Stat({
  label,
  value,
  hint,
  good,
  compact,
}: {
  label: string;
  /** null renders as "no data yet" — never as 0, which would read as a real, bad result. */
  value: number | string | null;
  hint?: string;
  good?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={compact ? '' : 'bg-white rounded-xl border border-slate-200 p-5'}>
      <div
        className={`text-2xl font-bold ${
          value === null ? 'text-slate-300' : good === true ? 'text-green-600' : 'text-slate-800'
        }`}
      >
        {value === null ? '—' : value}
      </div>
      <div className="text-sm font-medium text-slate-600 mt-0.5">{label}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{value === null ? 'No data yet' : hint}</div>}
    </div>
  );
}
