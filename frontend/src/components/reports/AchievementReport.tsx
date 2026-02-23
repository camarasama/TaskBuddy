'use client';
/**
 * AchievementReport — R-05
 * Auth-fixed exports (CSV + PDF). Uses downloadExport() with Bearer token.
 */

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, ResponsiveContainer } from 'recharts';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';

interface AchievementRow { childId: string; childName: string; currentLevel: number; experiencePoints: number; totalXpEarned: number; achievementsUnlocked: number; latestAchievementName: string | null; latestAchievementTier: string | null; latestUnlockedAt: string | null; }
interface Report { rows: AchievementRow[]; levelDistribution: Record<number, number>; xpVelocity: Array<{ date: string; xpEarned: number }>; summary: { totalAchievementsUnlocked: number; averageLevel: number } }

export default function AchievementReport({ childId, startDate, endDate }: { childId?: string; startDate?: string; endDate?: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await reportsApi.getAchievement({ childId, startDate, endDate }) as Report); }
    finally { setLoading(false); }
  }, [childId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('achievement', { childId, startDate, endDate })
        : reportsApi.exportPdfUrl('achievement', { childId, startDate, endDate });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-05…</div>;
  if (!report) return null;

  const levelData = Object.entries(report.levelDistribution).sort(([a], [b]) => Number(a) - Number(b)).map(([level, count]) => ({ level: `Lv ${level}`, count }));
  const xpData = report.xpVelocity.slice(-30).map((e) => ({ ...e, date: e.date.slice(5) }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center"><div className="text-2xl font-bold text-indigo-600">{report.summary.totalAchievementsUnlocked}</div><div className="text-xs text-gray-500 mt-1">Total Achievements Unlocked</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center"><div className="text-2xl font-bold text-amber-500">Lv {report.summary.averageLevel}</div><div className="text-xs text-gray-500 mt-1">Average Level</div></div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">XP Velocity (last 30 days)</h3>
          <ResponsiveContainer width="100%" height={180}><LineChart data={xpData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="xpEarned" stroke="#f59e0b" strokeWidth={2} dot={false} name="XP Earned" /></LineChart></ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Level Distribution</h3>
          <ResponsiveContainer width="100%" height={180}><BarChart data={levelData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="level" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Children" /></BarChart></ResponsiveContainer>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="min-w-full text-sm"><thead className="bg-gray-50"><tr>{['Child', 'Level', 'XP', 'Total XP', 'Achievements', 'Latest'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">{report.rows.map((r) => (
            <tr key={r.childId} className="hover:bg-gray-50/50">
              <td className="px-3 py-2 font-medium text-gray-800">{r.childName}</td><td className="px-3 py-2"><span className="font-bold text-amber-500">Lv {r.currentLevel}</span></td><td className="px-3 py-2 text-gray-600">{r.experiencePoints}</td><td className="px-3 py-2 text-gray-600">{r.totalXpEarned}</td><td className="px-3 py-2 text-gray-700">{r.achievementsUnlocked}</td><td className="px-3 py-2 text-gray-500 text-xs">{r.latestAchievementName ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex gap-3">
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>
    </div>
  );
}