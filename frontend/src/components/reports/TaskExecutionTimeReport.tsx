'use client';
/**
 * TaskExecutionTimeReport - R-11
 * Visualises task execution time: actual vs estimated, per-child avg,
 * per-difficulty avg, and flags anomalous completions.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';
import { AlertCircle, Download } from 'lucide-react';
import { formatDate } from '@/lib/utils';

interface Row {
  date: string; childName: string; taskTitle: string;
  difficulty: string | null; estimatedMinutes: number | null;
  actualMinutes: number; ratio: number | null;
  anomaly: boolean; anomalyReason: string | null;
}
interface Summary {
  totalRecords: number; avgActualMinutes: number;
  medianActualMinutes: number; onTimeRate: number; anomalyCount: number;
  byDifficulty: Record<string, { avg: number; count: number }>;
  byChild: Record<string, { name: string; avg: number; count: number }>;
}
interface Report { rows: Row[]; summary: Summary; }
interface Props { childId?: string; startDate?: string; endDate?: string; }

const DIFF_COLORS: Record<string, string> = { easy: '#22c55e', medium: '#f59e0b', hard: '#ef4444', unknown: '#94a3b8' };

function fmt(min: number): string {
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function TaskExecutionTimeReport({ childId, startDate, endDate }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setReport(await reportsApi.getExecutionTime({ childId, startDate, endDate }) as Report); }
    catch { setError('Failed to load execution time report'); }
    finally { setLoading(false); }
  }, [childId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('task-execution-time', { childId, startDate, endDate })
        : reportsApi.exportPdfUrl('task-execution-time', { childId, startDate, endDate });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-11…</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!report) return null;

  const { summary } = report;

  // Charts data
  const diffData = Object.entries(summary.byDifficulty).map(([diff, d]) => ({
    name: diff, avg: d.avg, count: d.count,
  }));
  const childData = Object.entries(summary.byChild)
    .map(([, d]) => ({ name: d.name.split(' ')[0], avg: d.avg, count: d.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 10);

  // Ratio distribution (buckets: <30%, 30-80%, 80-120%, 120-300%, >300%)
  const ratioBuckets = [
    { name: '<30%', count: 0, color: '#ef4444' },
    { name: '30-80%', count: 0, color: '#f59e0b' },
    { name: '80-120%', count: 0, color: '#22c55e' },
    { name: '120-300%', count: 0, color: '#f59e0b' },
    { name: '>300%', count: 0, color: '#ef4444' },
  ];
  for (const r of report.rows) {
    if (r.ratio === null) continue;
    const pct = r.ratio * 100;
    if (pct < 30) ratioBuckets[0].count++;
    else if (pct < 80) ratioBuckets[1].count++;
    else if (pct < 120) ratioBuckets[2].count++;
    else if (pct < 300) ratioBuckets[3].count++;
    else ratioBuckets[4].count++;
  }

  return (
    <div className="space-y-6">
      {/* Export buttons */}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => handleExport('csv')}
          disabled={!!exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          {exporting === 'csv' ? 'Exporting…' : 'CSV'}
        </button>
        <button
          onClick={() => handleExport('pdf')}
          disabled={!!exporting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          {exporting === 'pdf' ? 'Exporting…' : 'PDF'}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: 'Tasks with timing', value: summary.totalRecords },
          { label: 'Avg time', value: fmt(summary.avgActualMinutes) },
          { label: 'Median time', value: fmt(summary.medianActualMinutes) },
          { label: 'On-time rate', value: `${summary.onTimeRate}%` },
          { label: 'Anomalies', value: summary.anomalyCount, warn: summary.anomalyCount > 0 },
        ].map((s) => (
          <div key={s.label} className={`bg-white rounded-xl border p-4 shadow-sm text-center ${(s as any).warn ? 'border-amber-300 bg-amber-50' : 'border-gray-100'}`}>
            <div className={`text-2xl font-bold ${(s as any).warn ? 'text-amber-600' : 'text-indigo-600'}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Avg time by difficulty */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Avg time by difficulty</h3>
          {diffData.length === 0 ? <p className="text-xs text-gray-400">No data</p> : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={diffData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="m" />
                <Tooltip formatter={(v: any) => [`${v}m`, 'Avg']} />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                  {diffData.map((d) => <Cell key={d.name} fill={DIFF_COLORS[d.name] ?? '#94a3b8'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Avg time by child */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Avg time by child</h3>
          {childData.length === 0 ? <p className="text-xs text-gray-400">No data</p> : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={childData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit="m" />
                <Tooltip formatter={(v: any) => [`${v}m`, 'Avg']} />
                <Bar dataKey="avg" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Completion speed distribution */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Speed vs estimate</h3>
          <p className="text-xs text-gray-400 mb-2">Only tasks with an estimated time</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={ratioBuckets} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => [v, 'Tasks']} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {ratioBuckets.map((b) => <Cell key={b.name} fill={b.color} />)}
              </Bar>
              <ReferenceLine x="80-120%" stroke="#22c55e" strokeDasharray="3 3" label={{ value: 'target', fontSize: 10 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Anomaly callout */}
      {summary.anomalyCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800">{summary.anomalyCount} anomalous completion{summary.anomalyCount > 1 ? 's' : ''} detected</p>
            <p className="text-xs text-amber-700 mt-0.5">These tasks were completed significantly faster (&lt;30%) or slower (&gt;300%) than the estimated time. Auto-approve was withheld and they require manual review.</p>
          </div>
        </div>
      )}

      {/* Detail table */}
      {report.rows.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Detail ({report.rows.length} records)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  {['Date', 'Child', 'Task', 'Difficulty', 'Estimated', 'Actual', 'Speed', 'Flag'].map((h) => (
                    <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {report.rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className={r.anomaly ? 'bg-amber-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-2 text-gray-500">{formatDate(r.date)}</td>
                    <td className="px-4 py-2 font-medium">{r.childName.split(' ')[0]}</td>
                    <td className="px-4 py-2 max-w-xs truncate text-gray-700">{r.taskTitle}</td>
                    <td className="px-4 py-2">
                      {r.difficulty && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ background: DIFF_COLORS[r.difficulty] + '22', color: DIFF_COLORS[r.difficulty] }}>
                          {r.difficulty}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-500">{r.estimatedMinutes ? `${r.estimatedMinutes}m` : '-'}</td>
                    <td className="px-4 py-2 font-medium">{fmt(r.actualMinutes)}</td>
                    <td className="px-4 py-2">
                      {r.ratio !== null ? (
                        <span className={`text-xs font-semibold ${r.anomaly ? 'text-amber-600' : 'text-green-600'}`}>
                          {Math.round(r.ratio * 100)}%
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-2">
                      {r.anomaly && (
                        <span title={r.anomalyReason ?? ''} className="text-amber-500 cursor-help">⚠️</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.rows.length > 100 && (
              <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                Showing first 100 of {report.rows.length} records.
              </div>
            )}
          </div>
        </div>
      )}

      {report.rows.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center text-gray-400 text-sm">
          No timed completions yet. Children must use the <strong>Start Task</strong> button for execution time to be tracked.
        </div>
      )}
    </div>
  );
}
