'use client';
/**
 * TaskCompletionReport — R-01
 * Auth-fixed exports (CSV + PDF). Uses downloadExport() with Bearer token.
 */

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';

interface TaskCompletionRow { date: string; childId: string; childName: string; taskTitle: string; taskTag: string; difficulty: string | null; pointsAwarded: number; xpAwarded: number; completedAt: string; approvedAt: string | null; }
interface Report { rows: TaskCompletionRow[]; summary: { totalCompleted: number; totalApproved: number; primaryCount: number; secondaryCount: number; byDifficulty: Record<string, number>; byChild: Record<string, number> } }
interface Props { childId?: string; startDate?: string; endDate?: string; }

const DIFF_COLORS: Record<string, string> = { easy: '#22c55e', medium: '#f59e0b', hard: '#ef4444', unknown: '#94a3b8' };
const TAG_COLORS = ['#6366f1', '#a78bfa'];

export default function TaskCompletionReport({ childId, startDate, endDate }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setReport(await reportsApi.getTaskCompletion({ childId, startDate, endDate }) as Report); }
    catch { setError('Failed to load task completion report'); }
    finally { setLoading(false); }
  }, [childId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('task-completion', { childId, startDate, endDate })
        : reportsApi.exportPdfUrl('task-completion', { childId, startDate, endDate });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-01…</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!report) return null;

  const dailyMap: Record<string, number> = {};
  for (const r of report.rows) dailyMap[r.date] = (dailyMap[r.date] ?? 0) + 1;
  const dailyData = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([date, count]) => ({ date: date.slice(5), count }));
  const diffData = Object.entries(report.summary.byDifficulty).map(([name, value]) => ({ name, value }));
  const tagData = [{ name: 'Primary', value: report.summary.primaryCount }, { name: 'Secondary', value: report.summary.secondaryCount }];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[{ label: 'Total Completed', value: report.summary.totalCompleted }, { label: 'Approved', value: report.summary.totalApproved }, { label: 'Primary Tasks', value: report.summary.primaryCount }, { label: 'Bonus Tasks', value: report.summary.secondaryCount }].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-indigo-600">{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Completions Over Time (last 30 days)</h3>
        <ResponsiveContainer width="100%" height={220}><BarChart data={dailyData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} name="Completed" /></BarChart></ResponsiveContainer>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">By Difficulty</h3>
          <ResponsiveContainer width="100%" height={180}><PieChart><Pie data={diffData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>{diffData.map((d) => <Cell key={d.name} fill={DIFF_COLORS[d.name] ?? '#94a3b8'} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Primary vs Bonus</h3>
          <ResponsiveContainer width="100%" height={180}><PieChart><Pie data={tagData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>{tagData.map((d, i) => <Cell key={d.name} fill={TAG_COLORS[i]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="min-w-full text-sm"><thead className="bg-gray-50"><tr>{['Date', 'Child', 'Task', 'Tag', 'Difficulty', 'Points', 'XP', 'Approved'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">{report.rows.slice(0, 50).map((r, i) => (
            <tr key={i} className="hover:bg-gray-50/50">
              <td className="px-3 py-2 text-gray-600">{r.date}</td><td className="px-3 py-2 font-medium text-gray-800">{r.childName}</td><td className="px-3 py-2 text-gray-600 max-w-[180px] truncate">{r.taskTitle}</td>
              <td className="px-3 py-2"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.taskTag === 'primary' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>{r.taskTag}</span></td>
              <td className="px-3 py-2 text-gray-600 capitalize">{r.difficulty ?? '—'}</td><td className="px-3 py-2 text-gray-700">{r.pointsAwarded}</td><td className="px-3 py-2 text-gray-700">{r.xpAwarded}</td><td className="px-3 py-2 text-gray-500">{r.approvedAt ? '✓' : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {report.rows.length > 50 && <div className="px-4 py-3 text-sm text-gray-500 bg-gray-50 border-t">Showing 50 of {report.rows.length} rows — export CSV for full data</div>}
      </div>
    </div>
  );
}