'use client';
/**
 * WebhookReport - R-13 (growth roadmap §6)
 *
 * FR-18 auto-disables a subscription after repeated failures and, until now, told nobody in any
 * durable way — an integration could be dead for a week with nothing showing it. Auto-disabled rows
 * are therefore sorted and styled to be the first thing anyone sees.
 *
 * The signing secret is not part of the report payload at all, so there is nothing here to mask.
 */

import { useEffect, useState, useCallback } from 'react';
import type { WebhookReport as WebhookReportData } from '@taskbuddy/shared';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';
import { formatDate } from '@/lib/utils';

interface Props { familyId?: string; startDate?: string; endDate?: string; }

export default function WebhookReport({ familyId }: Props) {
  const [report, setReport] = useState<WebhookReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setReport(await reportsApi.getWebhookDeliveries({ familyId })); }
    finally { setLoading(false); }
  }, [familyId]);

  useEffect(() => { load(); }, [load]);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('webhook-deliveries', { familyId })
        : reportsApi.exportPdfUrl('webhook-deliveries', { familyId });
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-13…</div>;
  if (!report) return null;

  if (report.rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-200 p-10 text-center">
        <p className="font-semibold text-gray-700 mb-1">No webhook subscriptions</p>
        <p className="text-sm text-gray-500">Nothing is subscribed to family events yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {report.summary.autoDisabled > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-700">
            {report.summary.autoDisabled} subscription{report.summary.autoDisabled === 1 ? '' : 's'} auto-disabled after repeated failures
          </p>
          <p className="text-xs text-red-600 mt-1">
            Events are no longer being delivered to these endpoints. Fix the endpoint, then re-enable
            the subscription in settings.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Subscriptions', value: report.summary.total, color: 'text-indigo-600' },
          { label: 'Active', value: report.summary.active, color: 'text-green-600' },
          { label: 'Auto-disabled', value: report.summary.autoDisabled, color: report.summary.autoDisabled > 0 ? 'text-red-500' : 'text-gray-400' },
          { label: 'Failing', value: report.summary.failing, color: report.summary.failing > 0 ? 'text-amber-500' : 'text-gray-400' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>

      <div className="space-y-3">
        {report.rows.map((r) => {
          const state = r.disabledAt ? 'disabled' : r.isActive ? 'active' : 'paused';
          const badge = {
            disabled: 'bg-red-50 text-red-700 border-red-200',
            active: 'bg-green-50 text-green-700 border-green-200',
            paused: 'bg-gray-50 text-gray-600 border-gray-200',
          }[state];

          return (
            <div key={r.subscriptionId} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-gray-700 truncate max-w-[420px]">{r.url}</p>
                  <p className="text-xs text-gray-500 mt-1">{r.events.join(', ')}</p>
                </div>
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge}`}>
                  {state === 'disabled' ? 'Auto-disabled' : state === 'active' ? 'Active' : 'Paused'}
                </span>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-xs">
                <div><span className="text-gray-400 block">Consecutive failures</span><span className={r.consecutiveFailures > 0 ? 'text-amber-600 font-semibold' : 'text-gray-600'}>{r.consecutiveFailures}</span></div>
                <div><span className="text-gray-400 block">Last success</span><span className="text-gray-600">{r.lastSuccessAt ? formatDate(r.lastSuccessAt) : '—'}</span></div>
                <div><span className="text-gray-400 block">Last failure</span><span className="text-gray-600">{r.lastFailureAt ? formatDate(r.lastFailureAt) : '—'}</span></div>
                <div><span className="text-gray-400 block">Disabled at</span><span className={r.disabledAt ? 'text-red-600 font-semibold' : 'text-gray-600'}>{r.disabledAt ? formatDate(r.disabledAt) : '—'}</span></div>
              </div>

              {r.recentFailures.length > 0 && (
                <div className="mt-3 border-t border-gray-50 pt-3">
                  <button
                    onClick={() => setExpanded(expanded === r.subscriptionId ? null : r.subscriptionId)}
                    className="text-xs text-indigo-600 hover:text-indigo-700"
                  >
                    {expanded === r.subscriptionId ? 'Hide' : `Show ${r.recentFailures.length} recent failure${r.recentFailures.length === 1 ? '' : 's'}`}
                  </button>
                  {expanded === r.subscriptionId && (
                    <div className="mt-2 space-y-1">
                      {r.recentFailures.map((f, i) => (
                        <div key={i} className="flex items-start justify-between gap-3 text-xs border-b border-gray-50 pb-1">
                          <span className="text-gray-500">{formatDate(f.at)} · {f.event}</span>
                          <span className="font-mono text-red-500 shrink-0">{f.status ? `${f.status} ` : ''}{f.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
