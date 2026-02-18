/**
 * app/admin/audit-log/page.tsx — M8
 *
 * Audit log viewer. Paginated table showing all system mutations with filters
 * for actor, action type, resource type, family, and date range.
 * Includes a CSV export button that downloads all matching rows.
 *
 * Acceptance test T3:
 *   "As a parent, create a task, approve a submission, redeem a reward.
 *    Then as admin, go to the Audit Log viewer and filter by the parent's
 *    user ID. Three entries appear with correct action / resourceType / timestamp."
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { adminApi, getAccessToken } from '@/lib/api';

interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  familyId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface PageData {
  logs: AuditLogEntry[];
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 50;

// Action verb → colour badge
const ACTION_COLORS: Record<string, string> = {
  CREATE:         'bg-green-100 text-green-700',
  UPDATE:         'bg-blue-100 text-blue-700',
  DELETE:         'bg-red-100 text-red-700',
  APPROVE:        'bg-emerald-100 text-emerald-700',
  REJECT:         'bg-orange-100 text-orange-700',
  REDEEM:         'bg-purple-100 text-purple-700',
  FULFILL:        'bg-teal-100 text-teal-700',
  CANCEL:         'bg-rose-100 text-rose-700',
  SUSPEND:        'bg-red-100 text-red-700',
  REACTIVATE:     'bg-green-100 text-green-700',
  LOGIN:          'bg-slate-100 text-slate-600',
  REGISTER:       'bg-indigo-100 text-indigo-700',
  INVITE_SENT:    'bg-sky-100 text-sky-700',
  INVITE_ACCEPTED:'bg-sky-100 text-sky-700',
  FORCE_RESET:    'bg-amber-100 text-amber-700',
  COMPLETE:       'bg-emerald-100 text-emerald-700',
  SELF_ASSIGN:    'bg-violet-100 text-violet-700',
  SKIP:           'bg-yellow-100 text-yellow-700',
};

export default function AdminAuditLogPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state
  const [filters, setFilters] = useState({
    actorId:      '',
    action:       '',
    resourceType: '',
    familyId:     '',
    from:         '',
    to:           '',
  });
  const [appliedFilters, setAppliedFilters] = useState({ ...filters });

  const load = useCallback(async (p: number, f: typeof filters) => {
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = { page: p, limit: PAGE_SIZE };
      if (f.actorId)      params.actorId      = f.actorId;
      if (f.action)       params.action       = f.action;
      if (f.resourceType) params.resourceType = f.resourceType;
      if (f.familyId)     params.familyId     = f.familyId;
      if (f.from)         params.from         = new Date(f.from).toISOString();
      if (f.to)           params.to           = new Date(f.to + 'T23:59:59').toISOString();

      const res = await adminApi.getAuditLogs(params);
      setData(res.data as PageData);
    } catch {
      setError('Failed to load audit logs.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(page, appliedFilters); }, [page, appliedFilters, load]);

  function applyFilters() {
    setPage(1);
    setAppliedFilters({ ...filters });
  }

  function resetFilters() {
    const empty = { actorId: '', action: '', resourceType: '', familyId: '', from: '', to: '' };
    setFilters(empty);
    setAppliedFilters(empty);
    setPage(1);
  }

  async function handleExport() {
    setExportLoading(true);
    try {
      // Build URL and trigger download via anchor click
      const params: Record<string, string> = {};
      if (appliedFilters.actorId)      params.actorId      = appliedFilters.actorId;
      if (appliedFilters.action)       params.action       = appliedFilters.action;
      if (appliedFilters.resourceType) params.resourceType = appliedFilters.resourceType;
      if (appliedFilters.familyId)     params.familyId     = appliedFilters.familyId;
      if (appliedFilters.from)         params.from         = new Date(appliedFilters.from).toISOString();
      if (appliedFilters.to)           params.to           = new Date(appliedFilters.to + 'T23:59:59').toISOString();

      const url = adminApi.exportAuditLogs(params);
      const token = getAccessToken();

      // Fetch with auth header and trigger browser download
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `taskbuddy-audit-log-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      setError('CSV export failed. Please try again.');
    } finally {
      setExportLoading(false);
    }
  }

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Audit Log</h2>
          <p className="text-slate-500 text-sm mt-1">
            {data ? `${data.total.toLocaleString()} entries` : 'Loading…'}
            {hasActiveFilters && ' (filtered)'}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exportLoading}
          className="text-sm border border-slate-200 text-slate-600 hover:bg-slate-50 px-4 py-2 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {exportLoading ? 'Exporting…' : '⬇ Export CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label: 'Actor ID',      key: 'actorId',      placeholder: 'User UUID' },
            { label: 'Action',        key: 'action',       placeholder: 'e.g. APPROVE' },
            { label: 'Resource Type', key: 'resourceType', placeholder: 'e.g. task' },
            { label: 'Family ID',     key: 'familyId',     placeholder: 'Family UUID' },
          ].map(({ label, key, placeholder }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
              <input
                value={(filters as any)[key]}
                onChange={(e) => setFilters((p) => ({ ...p, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={applyFilters}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-4 py-1.5 rounded-lg transition-colors"
          >
            Apply Filters
          </button>
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="text-slate-500 text-xs px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-slate-600 whitespace-nowrap">Timestamp</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Action</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 whitespace-nowrap">Resource Type</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 whitespace-nowrap">Resource ID</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 whitespace-nowrap">Actor ID</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-3 bg-slate-100 rounded w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data?.logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No audit log entries found{hasActiveFilters ? ' for the current filters.' : '.'}
                  </td>
                </tr>
              ) : (
                data?.logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap font-mono">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded ${ACTION_COLORS[log.action] || 'bg-slate-100 text-slate-600'}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600 font-mono">{log.resourceType}</td>
                    <td className="px-4 py-2.5 text-slate-400 font-mono">
                      <span title={log.resourceId}>
                        {log.resourceId.slice(0, 8)}…
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 font-mono">
                      {log.actorId ? (
                        <span title={log.actorId}>{log.actorId.slice(0, 8)}…</span>
                      ) : (
                        <span className="text-slate-300 italic">system</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 max-w-xs">
                      {log.metadata ? (
                        <span
                          title={JSON.stringify(log.metadata, null, 2)}
                          className="cursor-help truncate block max-w-[200px]"
                        >
                          {JSON.stringify(log.metadata)}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Page {page} of {data.totalPages} ({data.total.toLocaleString()} total)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50 text-sm"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
                className="px-3 py-1 rounded border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50 text-sm"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
