'use client';
/**
 * AuditTrailReport — R-09
 * Auth-fixed exports (CSV + PDF). Uses downloadExport() with Bearer token.
 */

import { useEffect, useState, useCallback } from 'react';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';

interface AuditRow { id: string; actorName: string | null; action: string; resourceType: string; resourceId: string; familyId: string | null; ipAddress: string | null; createdAt: string; }
interface Report { rows: AuditRow[]; total: number; summary: { byAction: Record<string, number>; byResourceType: Record<string, number> } }
interface Props { familyId?: string; startDate?: string; endDate?: string; }

const ACTION_COLORS: Record<string, string> = { CREATE: 'bg-green-100 text-green-700', UPDATE: 'bg-blue-100 text-blue-700', DELETE: 'bg-red-100 text-red-700', APPROVE: 'bg-indigo-100 text-indigo-700', REJECT: 'bg-orange-100 text-orange-700', REDEEM: 'bg-purple-100 text-purple-700', LOGIN: 'bg-gray-100 text-gray-600', REGISTER: 'bg-teal-100 text-teal-700', SUSPEND: 'bg-red-200 text-red-800' };

export default function AuditTrailReport({ familyId, startDate, endDate }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterAction, setFilterAction] = useState('');
  const [filterResource, setFilterResource] = useState('');
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await reportsApi.getAuditTrail({ familyId, startDate, endDate, page, pageSize: 50 }) as Report); }
    finally { setLoading(false); }
  }, [familyId, startDate, endDate, page]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('audit-trail', { familyId, startDate, endDate })
        : reportsApi.exportPdfUrl('audit-trail', { familyId, startDate, endDate });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-09…</div>;
  if (!report) return null;

  const actions = Object.keys(report.summary.byAction);
  const resourceTypes = Object.keys(report.summary.byResourceType);
  const filtered = report.rows.filter((r) => {
    if (filterAction && r.action !== filterAction) return false;
    if (filterResource && r.resourceType !== filterResource) return false;
    return true;
  });
  const totalPages = Math.ceil(report.total / 50);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="rounded-lg border border-gray-200 text-sm px-3 py-1.5 bg-white text-gray-700">
          <option value="">All Actions</option>{actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={filterResource} onChange={(e) => setFilterResource(e.target.value)} className="rounded-lg border border-gray-200 text-sm px-3 py-1.5 bg-white text-gray-700">
          <option value="">All Resources</option>{resourceTypes.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{report.total} total log entries</span>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="min-w-full text-sm"><thead className="bg-gray-50"><tr>{['Timestamp', 'Actor', 'Action', 'Resource', 'Resource ID', 'IP'].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-50">{filtered.map((r) => (
            <tr key={r.id} className="hover:bg-gray-50/50">
              <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td><td className="px-3 py-2 font-medium text-gray-700">{r.actorName ?? 'System'}</td>
              <td className="px-3 py-2"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_COLORS[r.action] ?? 'bg-gray-100 text-gray-600'}`}>{r.action}</span></td>
              <td className="px-3 py-2 text-gray-600">{r.resourceType}</td><td className="px-3 py-2 text-gray-400 font-mono text-xs">{r.resourceId.slice(0, 8)}…</td><td className="px-3 py-2 text-gray-400 text-xs">{r.ipAddress ?? '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">← Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Next →</button>
        </div>
      )}
      <div className="flex gap-3">
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>
    </div>
  );
}