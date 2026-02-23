'use client';
/**
 * EngagementStreakReport — R-04
 * Auth-fixed exports (CSV + PDF). Uses downloadExport() with Bearer token.
 */

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';

interface EngagementRow { childId: string; childName: string; currentStreak: number; longestStreak: number; totalTasksCompleted: number; lastActivityDate: string | null; primaryAdherenceRate: number; activityByDate: Record<string, number>; }
interface Report { rows: EngagementRow[]; summary: { averageStreak: number; maxStreak: number; totalActiveChildren: number } }
interface Props { childId?: string; startDate?: string; endDate?: string; }

function ActivityHeatmap({ activityByDate }: { activityByDate: Record<string, number> }) {
  const days: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = 69; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const key = d.toISOString().split('T')[0];
    days.push({ date: key, count: activityByDate[key] ?? 0 });
  }
  const getColor = (c: number) => c === 0 ? '#f1f5f9' : c === 1 ? '#c7d2fe' : c === 2 ? '#818cf8' : '#4f46e5';
  const weeks: typeof days[] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <div className="flex gap-1 overflow-x-auto pb-2">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-1">
          {week.map((day) => <div key={day.date} title={`${day.date}: ${day.count} task${day.count !== 1 ? 's' : ''}`} className="w-4 h-4 rounded-sm cursor-default" style={{ backgroundColor: getColor(day.count) }} />)}
        </div>
      ))}
    </div>
  );
}

export default function EngagementStreakReport({ childId, startDate, endDate }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await reportsApi.getEngagementStreak({ childId, startDate, endDate }) as Report); }
    finally { setLoading(false); }
  }, [childId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('engagement-streak', { childId, startDate, endDate })
        : reportsApi.exportPdfUrl('engagement-streak', { childId, startDate, endDate });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-04…</div>;
  if (!report) return null;

  const streakData = report.rows.map((r) => ({ name: r.childName.split(' ')[0], current: r.currentStreak, longest: r.longestStreak }));
  const adherenceData = report.rows.map((r) => ({ name: r.childName.split(' ')[0], adherence: r.primaryAdherenceRate }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[{ label: 'Avg Current Streak', value: `${report.summary.averageStreak}d` }, { label: 'Longest Streak', value: `${report.summary.maxStreak}d` }, { label: 'Active Children', value: report.summary.totalActiveChildren }].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-indigo-600">{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>
      {report.rows.map((child) => (
        <div key={child.childId} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div><h3 className="text-sm font-semibold text-gray-800">{child.childName}</h3><p className="text-xs text-gray-500 mt-0.5">🔥 {child.currentStreak}d streak · 🏆 {child.longestStreak}d best · ✓ {child.totalTasksCompleted} total</p></div>
            <div className="text-right"><div className="text-sm font-bold text-indigo-600">{child.primaryAdherenceRate}%</div><div className="text-xs text-gray-500">primary adherence</div></div>
          </div>
          <ActivityHeatmap activityByDate={child.activityByDate} />
          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400"><span>Less</span>{['#f1f5f9', '#c7d2fe', '#818cf8', '#4f46e5'].map((c) => <span key={c} className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: c }} />)}<span>More</span></div>
        </div>
      ))}
      {streakData.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Streak Comparison</h3>
          <ResponsiveContainer width="100%" height={200}><BarChart data={streakData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="current" fill="#6366f1" name="Current Streak (days)" radius={[4, 4, 0, 0]} /><Bar dataKey="longest" fill="#c7d2fe" name="Longest Streak (days)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </div>
      )}
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Primary Task Adherence %</h3>
        <ResponsiveContainer width="100%" height={180}><BarChart data={adherenceData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} /><Tooltip formatter={(v) => `${v}%`} /><Bar dataKey="adherence" fill="#22c55e" radius={[4, 4, 0, 0]} name="Adherence %" /></BarChart></ResponsiveContainer>
      </div>
      <div className="flex gap-3">
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>
    </div>
  );
}