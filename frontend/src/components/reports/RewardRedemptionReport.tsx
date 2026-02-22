'use client';

/**
 * RewardRedemptionReport — R-03
 * Top rewards + status breakdown + points spent over time.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer, Legend,
} from 'recharts';
import { reportsApi } from '@/lib/api';

interface RedemptionRow {
  date: string;
  childName: string;
  rewardName: string;
  rewardTier: string | null;
  pointsSpent: number;
  status: string;
  fulfilledAt: string | null;
}

interface Report {
  rows: RedemptionRow[];
  summary: {
    totalRedemptions: number;
    totalPointsSpent: number;
    byStatus: Record<string, number>;
    byTier: Record<string, number>;
    topRewards: Array<{ rewardName: string; count: number }>;
  };
}

interface Props { childId?: string; startDate?: string; endDate?: string; }

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#6366f1',
  fulfilled: '#22c55e',
  cancelled: '#94a3b8',
};

const TIER_COLORS = ['#6366f1', '#a78bfa', '#c4b5fd', '#94a3b8'];

export default function RewardRedemptionReport({ childId, startDate, endDate }: Props) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await reportsApi.getRewardRedemption({ childId, startDate, endDate }) as Report);
    } finally { setLoading(false); }
  }, [childId, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading R-03…</div>;
  if (!report) return null;

  const statusData = Object.entries(report.summary.byStatus).map(([name, value]) => ({ name, value }));
  const tierData = Object.entries(report.summary.byTier).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Total Redemptions', value: report.summary.totalRedemptions, color: 'text-indigo-600' },
          { label: 'Total Points Spent', value: report.summary.totalPointsSpent, color: 'text-red-500' },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Top 5 Redeemed Rewards</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={report.summary.topRewards} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis dataKey="rewardName" type="category" width={150} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="count" fill="#6366f1" radius={[0, 4, 4, 0]} name="Times Redeemed" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">By Status</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {statusData.map((d) => <Cell key={d.name} fill={STATUS_COLORS[d.name] ?? '#94a3b8'} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">By Reward Tier</h3>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={tierData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {tierData.map((d, i) => <Cell key={d.name} fill={TIER_COLORS[i % TIER_COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex gap-3">
        <a href={reportsApi.exportCsvUrl('reward-redemption', { childId, startDate, endDate })} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 text-white text-sm px-4 py-2 hover:bg-indigo-700 transition-colors">
          ↓ Export CSV
        </a>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Date', 'Child', 'Reward', 'Tier', 'Points', 'Status', 'Fulfilled'].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {report.rows.slice(0, 50).map((r, i) => (
              <tr key={i} className="hover:bg-gray-50/50">
                <td className="px-3 py-2 text-gray-600">{r.date}</td>
                <td className="px-3 py-2 font-medium text-gray-800">{r.childName}</td>
                <td className="px-3 py-2 text-gray-600">{r.rewardName}</td>
                <td className="px-3 py-2 text-gray-500 capitalize">{r.rewardTier ?? '—'}</td>
                <td className="px-3 py-2 text-red-500 font-medium">{r.pointsSpent}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ backgroundColor: `${STATUS_COLORS[r.status] ?? '#94a3b8'}20`, color: STATUS_COLORS[r.status] ?? '#64748b' }}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-500">{r.fulfilledAt ? r.fulfilledAt.split('T')[0] : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
