'use client';
/**
 * ExpiryOverdueReport — R-07
 * Auth-fixed exports (CSV + PDF). Uses downloadExport() with Bearer token.
 */

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';

interface ExpiryRow { taskId: string; taskTitle: string; taskTag: string; childName: string; dueDate: string; instanceDate: string; status: string; daysPastDue: number | null; }
interface Report { rows: ExpiryRow[]; summary: { totalOverdue: number; totalExpired: number; expiryRate: number; byChild: Record<string, number> } }
interface Props { childId?: string; startDate?: string; endDate?: string; }

export default function ExpiryOverdueReport({ childId, startDate, endDate }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await reportsApi.getExpiryOverdue({ childId, startDate, endDate }) as Report); }
    finally { setLoading(false); }
  }, [childId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('expiry-overdue', { childId, startDate, endDate })
        : reportsApi.exportPdfUrl('expiry-overdue', { childId, startDate, endDate });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-07…</div>;
  if (!report) return null;

  const byChildData = Object.entries(report.summary.byChild).map(([name, count]) => ({ name: name.split(' ')[0], count }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {[{ label: 'Overdue Tasks', value: report.summary.totalOverdue, color: 'text-orange-500' }, { label: 'Expired (>1 day)', value: report.summary.totalExpired, color: 'text-red-600' }, { label: 'Expiry Rate', value: `${report.summary.expiryRate}%`, color: 'text-gray-700' }].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>
      {byChildData.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Overdue Tasks by Child</h3>
          <ResponsiveContainer width="100%" height={180}><BarChart data={byChildData}><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#f97316" radius={[4, 4, 0, 0]} name="Overdue" /></BarChart></ResponsiveContainer>
        </div>
      )}
      {report.rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-8 text-center text-green-600 font-medium">✓ No overdue tasks — great work!</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="min-w-full text-sm"><thead className="bg-gray-50"><tr>{['Child', 'Task', 'Tag', 'Due Date', 'Status', 'Days Past Due'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-gray-50">{report.rows.map((r, i) => (
              <tr key={i} className={`hover:bg-gray-50/50 ${(r.daysPastDue ?? 0) > 3 ? 'bg-red-50/30' : ''}`}>
                <td className="px-3 py-2 font-medium text-gray-800">{r.childName}</td><td className="px-3 py-2 text-gray-600 max-w-[180px] truncate">{r.taskTitle}</td>
                <td className="px-3 py-2"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.taskTag === 'primary' ? 'bg-indigo-100 text-indigo-700' : 'bg-purple-100 text-purple-700'}`}>{r.taskTag}</span></td>
                <td className="px-3 py-2 text-gray-600">{r.dueDate}</td><td className="px-3 py-2 text-gray-500 capitalize">{r.status}</td>
                <td className="px-3 py-2">{r.daysPastDue !== null && r.daysPastDue > 0 ? <span className={`font-medium ${r.daysPastDue > 3 ? 'text-red-600' : 'text-orange-500'}`}>{r.daysPastDue}d overdue</span> : <span className="text-amber-500 text-xs">due soon</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="flex gap-3">
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>
    </div>
  );
}