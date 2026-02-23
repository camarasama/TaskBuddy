'use client';
/**
 * PlatformHealthReport — R-08
 * Auth-fixed exports (CSV + PDF). Uses downloadExport() with Bearer token.
 */

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { reportsApi } from '@/lib/api';
import { downloadExport } from '@/lib/downloadExport';

interface Report {
  userStats: { totalFamilies: number; totalParents: number; totalChildren: number; totalAdmins: number; newFamiliesThisMonth: number; activeFamiliesThisWeek: number };
  coParentStats: { totalInvitesSent: number; totalInvitesAccepted: number; totalInvitesCancelled: number; acceptanceRate: number; byRelationship: Record<string, number> };
  taskStats: { totalTasksCreated: number; totalAssignmentsApproved: number; averageApprovalTimeHours: number };
  activityMetrics: { dau: number; wau: number; mau: number };
}

export default function PlatformHealthReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try { setReport(await reportsApi.getPlatformHealth() as Report); }
      finally { setLoading(false); }
    })();
  }, []);

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    try {
      const url = format === 'csv'
        ? reportsApi.exportCsvUrl('platform-health')
        : reportsApi.exportPdfUrl('platform-health');
      await downloadExport(url);
    } catch (e) { alert(`Export failed: ${(e as Error).message}`); }
    finally { setExporting(null); }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-08…</div>;
  if (!report) return null;

  const activityData = [{ label: 'DAU', value: report.activityMetrics.dau }, { label: 'WAU', value: report.activityMetrics.wau }, { label: 'MAU', value: report.activityMetrics.mau }];
  const relData = Object.entries(report.coParentStats.byRelationship).map(([name, value]) => ({ name: name || 'unknown', value }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        {activityData.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
            <div className="text-2xl font-bold text-indigo-600">{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Platform Users</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[{ label: 'Families', value: report.userStats.totalFamilies }, { label: 'Parents', value: report.userStats.totalParents }, { label: 'Children', value: report.userStats.totalChildren }, { label: 'New Families (month)', value: report.userStats.newFamiliesThisMonth }].map((s) => (
            <div key={s.label} className="text-center bg-gray-50 rounded-lg p-3">
              <div className="text-xl font-bold text-gray-800">{s.value}</div>
              <div className="text-xs text-gray-500">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Co-Parent Adoption</h3>
          <div className="space-y-2 text-sm">
            {[['Invites Sent', report.coParentStats.totalInvitesSent], ['Accepted', report.coParentStats.totalInvitesAccepted], ['Cancelled', report.coParentStats.totalInvitesCancelled]].map(([label, val]) => (
              <div key={label} className="flex justify-between border-b border-gray-50 pb-2"><span className="text-gray-600">{label}</span><span className="font-semibold text-gray-800">{val}</span></div>
            ))}
            <div className="flex justify-between pt-1"><span className="text-gray-600 font-medium">Acceptance Rate</span><span className="font-bold text-indigo-600">{report.coParentStats.acceptanceRate}%</span></div>
          </div>
          {relData.length > 0 && (
            <div className="mt-4"><div className="text-xs text-gray-500 mb-2">By Relationship Type</div>
              <ResponsiveContainer width="100%" height={120}><BarChart data={relData}><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Task Activity</h3>
          <div className="space-y-3">
            {[{ label: 'Tasks Created', value: report.taskStats.totalTasksCreated }, { label: 'Assignments Approved', value: report.taskStats.totalAssignmentsApproved }, { label: 'Avg Approval Time', value: `${report.taskStats.averageApprovalTimeHours}h` }, { label: 'Active Families (week)', value: report.userStats.activeFamiliesThisWeek }].map((s) => (
              <div key={s.label} className="flex justify-between border-b border-gray-50 pb-2 text-sm"><span className="text-gray-600">{s.label}</span><span className="font-semibold text-gray-800">{s.value}</span></div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={() => handleExport('csv')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors">{exporting === 'csv' ? '⏳ Exporting…' : '↓ Export CSV'}</button>
        <button onClick={() => handleExport('pdf')} disabled={!!exporting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 text-indigo-600 text-sm px-4 py-2 hover:bg-indigo-50 disabled:opacity-60 transition-colors">{exporting === 'pdf' ? '⏳ Exporting…' : '↓ Export PDF'}</button>
      </div>
    </div>
  );
}