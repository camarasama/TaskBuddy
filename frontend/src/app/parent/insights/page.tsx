'use client';

/**
 * /parent/insights — the "is this actually working?" answer (growth roadmap §5.2).
 *
 * A parent who cannot see progress stops believing the app is doing anything. The consistency
 * heatmap is the piece the roadmap singles out, and it works precisely because the EMPTY squares
 * are visible — a chart that only showed active days would be a flattering lie.
 *
 * All bucketing is UTC (see InsightsService), which the page states rather than hides.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { reportsApi, dashboardApi } from '@/lib/api';
import type { InsightsReport } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEK_OPTIONS = [4, 12, 26] as const;

/** Five steps, so a busy day is visibly different from a quiet one without inventing precision. */
function heatLevel(count: number, max: number): number {
  if (count === 0) return 0;
  if (max <= 1) return 4;
  return Math.min(4, Math.ceil((count / max) * 4));
}

const HEAT_CLASSES = [
  'bg-slate-100',
  'bg-primary-100',
  'bg-primary-300',
  'bg-primary-500',
  'bg-primary-700',
];

export default function InsightsPage() {
  const { error: showError } = useToast();
  const [weeks, setWeeks] = useState<number>(12);
  const [childId, setChildId] = useState('');
  const [children, setChildren] = useState<Array<{ id: string; name: string }>>([]);
  const [data, setData] = useState<InsightsReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    dashboardApi
      .getParentDashboard()
      .then((res) => {
        const rows = (res.data as {
          children?: Array<{ user: { id: string; firstName?: string; lastName?: string } }>;
        }).children ?? [];
        setChildren(
          rows.map((r) => ({
            id: r.user.id,
            name: `${r.user.firstName ?? ''} ${r.user.lastName ?? ''}`.trim() || 'Child',
          })),
        );
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await reportsApi.insights({ weeks, childId: childId || undefined }));
    } catch {
      showError('Failed to load insights');
    } finally {
      setLoading(false);
    }
  }, [weeks, childId, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxDay = data ? Math.max(1, ...data.heatmap.map((d) => d.approved)) : 1;

  return (
    <ParentLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900">Insights</h1>
            <p className="text-slate-600 mt-1">
              How consistent your family has been, and whether the points economy is healthy.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <select
              value={childId}
              onChange={(e) => setChildId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700"
            >
              <option value="">All children</option>
              {children.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {WEEK_OPTIONS.map((w) => (
              <button
                key={w}
                onClick={() => setWeeks(w)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  weeks === w ? 'bg-primary-600 text-white' : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {w}w
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
          </div>
        ) : !data ? null : (
          <>
            {data.economy.inflationWarning && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-900">Points are piling up</p>
                  <p className="text-sm text-amber-800 mt-0.5">
                    {data.economy.inflationWarning}
                  </p>
                </div>
              </div>
            )}

            {/* Consistency heatmap — the empty squares are the point */}
            <section className="bg-white rounded-2xl border border-slate-200 p-5">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-display font-bold text-slate-900">Consistency</h2>
                <p className="text-xs text-slate-500">
                  {data.totals.approved} approved over {data.totals.activeDays} active days
                </p>
              </div>

              <div className="overflow-x-auto">
                <div className="inline-grid grid-flow-col grid-rows-7 gap-1">
                  {data.heatmap.map((day) => (
                    <div
                      key={day.date}
                      title={`${day.date}: ${day.approved} approved`}
                      className={cn('w-3 h-3 rounded-sm', HEAT_CLASSES[heatLevel(day.approved, maxDay)])}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
                <span>Less</span>
                {HEAT_CLASSES.map((cls) => (
                  <div key={cls} className={cn('w-3 h-3 rounded-sm', cls)} />
                ))}
                <span>More</span>
                <span className="ml-auto">Days are UTC</span>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="bg-white rounded-2xl border border-slate-200 p-5">
                <h2 className="font-display font-bold text-slate-900 mb-1">Best days</h2>
                <p className="text-xs text-slate-500 mb-4">
                  When tasks actually get finished — useful for deciding what to schedule when.
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={DAY_LABELS.map((d, i) => ({ day: d, approved: data.byDayOfWeek[i] }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip />
                    <Bar dataKey="approved" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>

              <section className="bg-white rounded-2xl border border-slate-200 p-5">
                <h2 className="font-display font-bold text-slate-900 mb-1">Time of day</h2>
                <p className="text-xs text-slate-500 mb-4">
                  Measured when the child finished, not when you approved it.
                </p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={data.byHourOfDay.map((count, hour) => ({ hour: `${hour}`, approved: count }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} stroke="#94a3b8" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                    <Tooltip />
                    <Bar dataKey="approved" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>
            </div>

            <section className="bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="font-display font-bold text-slate-900 mb-4">Points economy</h2>
              <div className="grid gap-4 sm:grid-cols-4">
                <Figure label="Earned" value={data.economy.pointsEarned} />
                <Figure label="Spent" value={data.economy.pointsSpent} />
                <Figure
                  label="Earn : spend"
                  value={data.economy.earnSpendRatio === null ? null : `${data.economy.earnSpendRatio}×`}
                  hint="Nothing spent yet"
                />
                <Figure label="Sitting unspent" value={data.economy.currentBalance} />
              </div>
            </section>
          </>
        )}
      </div>
    </ParentLayout>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  /** null shows an em dash — a real zero and "no data" are different things. */
  value: number | string | null;
  hint?: string;
}) {
  return (
    <div>
      <p className={cn('text-2xl font-bold', value === null ? 'text-slate-300' : 'text-slate-900')}>
        {value === null ? '—' : value}
      </p>
      <p className="text-sm text-slate-600">{label}</p>
      {value === null && hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}
