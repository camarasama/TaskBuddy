'use client';

/**
 * app/admin/emails/page.tsx — M9
 *
 * Admin email log viewer.
 * Shows all email_log records with status badges, filters, and a resend button
 * for failed emails.
 *
 * Route: /admin/emails
 * Auth: admin only (enforced by middleware/layout)
 */

import { useState, useEffect, useCallback } from 'react';
import { Mail, RefreshCw, AlertCircle, CheckCircle, Clock, Search, Filter } from 'lucide-react';
import { emailsApi } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EmailLog {
  id: string;
  toEmail: string;
  toUserId: string | null;
  familyId: string;
  triggerType: string;
  subject: string;
  status: 'sent' | 'failed' | 'bounced';
  errorMessage: string | null;
  referenceType: string | null;
  referenceId: string | null;
  resendCount: number;
  lastResentAt: string | null;
  createdAt: string;
  toUser?: { firstName: string; lastName: string; email: string; role: string } | null;
  family?: { familyName: string } | null;
}

interface LogsResponse {
  logs: EmailLog[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<string, string> = {
  welcome: 'Welcome',
  task_submitted: 'Task Submitted',
  task_approved: 'Task Approved',
  task_rejected: 'Task Rejected',
  task_expiring: 'Task Expiring',
  task_expired: 'Task Expired',
  reward_redeemed: 'Reward Redeemed',
  level_up: 'Level Up',
  streak_at_risk: 'Streak at Risk',
  co_parent_invite: 'Co-Parent Invite',
};

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EmailLog['status'] }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
        <CheckCircle className="w-3 h-3" /> Sent
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        <AlertCircle className="w-3 h-3" /> Failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
      <Clock className="w-3 h-3" /> Bounced
    </span>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function AdminEmailsPage() {
  const [data, setData] = useState<LogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [triggerFilter, setTriggerFilter] = useState('');
  const [searchEmail, setSearchEmail] = useState('');
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = { page, limit: 50 };
      if (statusFilter) params.status = statusFilter;
      if (triggerFilter) params.triggerType = triggerFilter;
      const result = await emailsApi.getLogs(params);
      setData(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to load email logs');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, triggerFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleResend = async (logId: string) => {
    setResending(logId);
    try {
      await emailsApi.resend(logId);
      await fetchLogs(); // Refresh to show updated resend count
    } catch (err: any) {
      alert(`Resend failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setResending(null);
    }
  };

  // Client-side email search filter
  const filteredLogs = data?.logs.filter((log) =>
    searchEmail ? log.toEmail.toLowerCase().includes(searchEmail.toLowerCase()) : true,
  ) ?? [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-lg">
            <Mail className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Email Logs</h1>
            <p className="text-sm text-gray-500">
              {data ? `${data.total.toLocaleString()} total records` : 'Loading...'}
            </p>
          </div>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Filter className="w-4 h-4 text-gray-400 shrink-0" />

          {/* Email search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by email..."
              value={searchEmail}
              onChange={(e) => setSearchEmail(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="bounced">Bounced</option>
          </select>

          {/* Trigger type filter */}
          <select
            value={triggerFilter}
            onChange={(e) => { setTriggerFilter(e.target.value); setPage(1); }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">All types</option>
            {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          {(statusFilter || triggerFilter || searchEmail) && (
            <button
              onClick={() => { setStatusFilter(''); setTriggerFilter(''); setSearchEmail(''); setPage(1); }}
              className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading && !data ? (
          <div className="p-12 text-center text-gray-400">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3" />
            <p className="text-sm">Loading email logs...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Mail className="w-8 h-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium">No email logs found</p>
            <p className="text-xs mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Recipient</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Subject</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Sent at</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredLogs.map((log) => (
                  <>
                    <tr
                      key={log.id}
                      className={`hover:bg-gray-50 cursor-pointer transition-colors ${expandedRow === log.id ? 'bg-indigo-50' : ''}`}
                      onClick={() => setExpandedRow(expandedRow === log.id ? null : log.id)}
                    >
                      {/* Recipient */}
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 truncate max-w-48">{log.toEmail}</div>
                        {log.toUser && (
                          <div className="text-xs text-gray-500">
                            {log.toUser.firstName} {log.toUser.lastName} · {log.toUser.role}
                          </div>
                        )}
                        {log.family && (
                          <div className="text-xs text-gray-400">{log.family.familyName}</div>
                        )}
                      </td>

                      {/* Type */}
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-medium rounded">
                          {TRIGGER_LABELS[log.triggerType] ?? log.triggerType}
                        </span>
                      </td>

                      {/* Subject */}
                      <td className="px-4 py-3 max-w-xs">
                        <p className="truncate text-gray-700">{log.subject}</p>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge status={log.status} />
                        {log.resendCount > 0 && (
                          <div className="text-xs text-gray-400 mt-0.5">Resent {log.resendCount}×</div>
                        )}
                      </td>

                      {/* Sent at */}
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('en-GB', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        {log.status === 'failed' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleResend(log.id); }}
                            disabled={resending === log.id}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <RefreshCw className={`w-3 h-3 ${resending === log.id ? 'animate-spin' : ''}`} />
                            {resending === log.id ? 'Sending...' : 'Resend'}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Expanded row — error details */}
                    {expandedRow === log.id && (
                      <tr key={`${log.id}-expand`} className="bg-indigo-50">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-4 text-xs text-gray-600">
                            <div>
                              <span className="font-medium text-gray-700">Log ID:</span>{' '}
                              <code className="bg-white px-1 rounded">{log.id}</code>
                            </div>
                            {log.referenceType && (
                              <div>
                                <span className="font-medium text-gray-700">Reference:</span>{' '}
                                {log.referenceType}/{log.referenceId}
                              </div>
                            )}
                            {log.errorMessage && (
                              <div className="col-span-2">
                                <span className="font-medium text-red-700">Error:</span>{' '}
                                <span className="text-red-600">{log.errorMessage}</span>
                              </div>
                            )}
                            {log.lastResentAt && (
                              <div>
                                <span className="font-medium text-gray-700">Last resent:</span>{' '}
                                {new Date(log.lastResentAt).toLocaleString('en-GB')}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Page {data.page} of {data.pages} ({data.total} total)
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(data.pages, p + 1))}
                disabled={page === data.pages || loading}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
