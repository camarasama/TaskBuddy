'use client';
/**
 * PointsLedgerReport — R-02
 * Auth-fixed exports (CSV + PDF). Uses downloadExport() with Bearer token.
 */

import { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend, Cell } from 'recharts';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';

interface LedgerRow { date: string; childName: string; transactionType: string; pointsAmount: number; balanceAfter: number; referenceType: string | null; description: string | null; }
interface Report { rows: LedgerRow[]; summary: { totalPointsEarned: number; totalPointsSpent: number; totalXpEvents: number; byType: Record<string, number>; byChild: Record<string, { earned: number; spent: number }> } }
interface Props { childId?: string; startDate?: string; endDate?: string; }

const TYPE_COLORS: Record<string, string> = { earned: '#22c55e', redeemed: '#ef4444', bonus: '#f59e0b', milestone_bonus: '#6366f1', adjustment: '#64748b', penalty: '#f43f5e' };

export default function PointsLedgerReport({ childId, startDate, endDate }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await reportsApi.getPointsLedger({ childId, startDate, endDate }) as Report); }
    finally { setLoading(false); }
  }, [childId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('points-ledger', { childId, startDate, endDate })
        : reportsApi.exportPdfUrl('points-ledger', { childId, startDate, endDate });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-02…</div>;
  if (!report) return null;

  const balanceData = [...report.rows].reverse().slice(0, 50).map((r, i) => ({ i: i + 1, balance: r.balanceAfter }));
  const typeData = Object.entries(report.summary.byType).map(([name, value]) => ({ name, value }));
  const childData = Object.entries(report.summary.byChild).map(([name, { earned, spent }]) => ({ name, earned, spent }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[{ label: 'Total Earned', value: report.summary.totalPointsEarned, color: 'text-green-600' }, { label: 'Total Spent', value: report.summary.totalPointsSpent, color: 'text-red-500' }, { label: 'Net Balance', value: report.summary.totalPointsEarned - report.summary.totalPointsSpent, color: 'text-indigo-600' }].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>
      {childData.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Earned vs Spent by Child</h3>
          <ResponsiveContainer width="100%" height={200}><BarChart data={childData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend /><Bar dataKey="earned" fill="#22c55e" radius={[4, 4, 0, 0]} name="Earned" /><Bar dataKey="spent" fill="#ef4444" radius={[4, 4, 0, 0]} name="Spent" /></BarChart></ResponsiveContainer>
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Running Balance</h3>
          <ResponsiveContainer width="100%" height={180}><LineChart data={balanceData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="i" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="balance" stroke="#6366f1" strokeWidth={2} dot={false} name="Balance" /></LineChart></ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">By Transaction Type</h3>
          <ResponsiveContainer width="100%" height={180}><BarChart data={typeData} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="value" radius={[0, 4, 4, 0]} name="Count">{typeData.map((d) => <Cell key={d.name} fill={TYPE_COLORS[d.name] ?? '#94a3b8'} />)}</Bar></BarChart></ResponsiveContainer>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="min-w-full text-sm"><thead className="bg-gray-50"><tr>{['Date', 'Child', 'Type', 'Amount', 'Balance After', 'Description'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">{report.rows.slice(0, 50).map((r, i) => (
            <tr key={i} className="hover:bg-gray-50/50">
              <td className="px-3 py-2 text-gray-600">{r.date}</td><td className="px-3 py-2 font-medium text-gray-800">{r.childName}</td>
              <td className="px-3 py-2"><span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">{r.transactionType}</span></td>
              <td className={`px-3 py-2 font-medium ${r.pointsAmount >= 0 ? 'text-green-600' : 'text-red-500'}`}>{r.pointsAmount >= 0 ? '+' : ''}{r.pointsAmount}</td>
              <td className="px-3 py-2 text-gray-700">{r.balanceAfter}</td><td className="px-3 py-2 text-gray-500 max-w-[200px] truncate">{r.description ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {report.rows.length > 50 && <div className="px-4 py-3 text-sm text-gray-500 bg-gray-50 border-t">Showing 50 of {report.rows.length} rows — export CSV for full data</div>}
      </div>
    </div>
  );
}