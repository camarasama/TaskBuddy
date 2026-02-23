'use client';
/**
 * EmailDeliveryReport — R-10
 * Auth-fixed exports (CSV + PDF). Uses downloadExport() with Bearer token.
 */

import { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';

interface EmailRow { date: string; triggerType: string; status: string; toEmail: string; subject: string; resendCount: number; errorMessage: string | null; createdAt: string; }
interface Report { rows: EmailRow[]; summary: { totalSent: number; totalFailed: number; totalBounced: number; deliveryRate: number; byTriggerType: Record<string, { sent: number; failed: number }>; failureReasons: Array<{ reason: string; count: number }> } }
interface Props { familyId?: string; startDate?: string; endDate?: string; }

const STATUS_COLORS: Record<string, string> = { sent: '#22c55e', failed: '#ef4444', bounced: '#f59e0b' };
const PIE_COLORS = ['#22c55e', '#ef4444', '#f59e0b'];

export default function EmailDeliveryReport({ familyId, startDate, endDate }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await reportsApi.getEmailDelivery({ familyId, startDate, endDate }) as Report); }
    finally { setLoading(false); }
  }, [familyId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('email-delivery', { familyId, startDate, endDate })
        : reportsApi.exportPdfUrl('email-delivery', { familyId, startDate, endDate });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-10…</div>;
  if (!report) return null;

  const statusPie = [{ name: 'Sent', value: report.summary.totalSent }, { name: 'Failed', value: report.summary.totalFailed }, { name: 'Bounced', value: report.summary.totalBounced }].filter((d) => d.value > 0);
  const triggerData = Object.entries(report.summary.byTriggerType).map(([name, { sent, failed }]) => ({ name: name.replace(/_/g, ' '), sent, failed }));
  const filtered = filterStatus ? report.rows.filter((r) => r.status === filterStatus) : report.rows;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[{ label: 'Total Sent', value: report.summary.totalSent, color: 'text-green-600' }, { label: 'Failed', value: report.summary.totalFailed, color: 'text-red-500' }, { label: 'Bounced', value: report.summary.totalBounced, color: 'text-amber-500' }, { label: 'Delivery Rate', value: `${report.summary.deliveryRate}%`, color: 'text-indigo-600' }].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Delivery Status Breakdown</h3>
          <ResponsiveContainer width="100%" height={180}><PieChart><Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>{statusPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Sent vs Failed by Trigger Type</h3>
          <ResponsiveContainer width="100%" height={180}><BarChart data={triggerData} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" /><XAxis type="number" tick={{ fontSize: 10 }} /><YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 9 }} /><Tooltip /><Bar dataKey="sent" fill="#22c55e" radius={[0, 4, 4, 0]} name="Sent" stackId="a" /><Bar dataKey="failed" fill="#ef4444" radius={[0, 4, 4, 0]} name="Failed" stackId="a" /></BarChart></ResponsiveContainer>
        </div>
      </div>
      {report.summary.failureReasons.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Failure Reasons</h3>
          <div className="space-y-2">{report.summary.failureReasons.map((f, i) => (
            <div key={i} className="flex items-start justify-between gap-4 text-sm border-b border-gray-50 pb-2"><span className="text-gray-600 font-mono text-xs">{f.reason}</span><span className="font-bold text-red-500 shrink-0">{f.count}×</span></div>
          ))}</div>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-lg border border-gray-200 text-sm px-3 py-1.5 bg-white text-gray-700">
          <option value="">All Statuses</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="bounced">Bounced</option>
        </select>
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="min-w-full text-sm"><thead className="bg-gray-50"><tr>{['Date', 'Trigger', 'Status', 'To', 'Subject', 'Resends'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">{filtered.slice(0, 50).map((r, i) => (
            <tr key={i} className="hover:bg-gray-50/50">
              <td className="px-3 py-2 text-gray-500 text-xs">{r.date}</td><td className="px-3 py-2 text-gray-600 text-xs">{r.triggerType.replace(/_/g, ' ')}</td>
              <td className="px-3 py-2"><span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${STATUS_COLORS[r.status]}20`, color: STATUS_COLORS[r.status] }}>{r.status}</span></td>
              <td className="px-3 py-2 text-gray-600 text-xs">{r.toEmail}</td><td className="px-3 py-2 text-gray-500 text-xs max-w-[200px] truncate">{r.subject}</td><td className="px-3 py-2 text-gray-500 text-xs">{r.resendCount > 0 ? r.resendCount : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
        {filtered.length > 50 && <div className="px-4 py-3 text-sm text-gray-500 bg-gray-50 border-t">Showing 50 of {filtered.length} rows — export CSV for full data</div>}
      </div>
    </div>
  );
}