'use client';

/**
 * /admin/reports — M10 Phase 4
 *
 * Admin reports hub. Same 10 reports as parent hub PLUS R-08 Platform Health.
 * No family filter restriction — admin can select any family.
 */

import { useState } from 'react';
import TaskCompletionReport from '@/components/reports/TaskCompletionReport';
import PointsLedgerReport from '@/components/reports/PointsLedgerReport';
import RewardRedemptionReport from '@/components/reports/RewardRedemptionReport';
import EngagementStreakReport from '@/components/reports/EngagementStreakReport';
import AchievementReport from '@/components/reports/AchievementReport';
import LeaderboardReport from '@/components/reports/LeaderboardReport';
import ExpiryOverdueReport from '@/components/reports/ExpiryOverdueReport';
import PlatformHealthReport from '@/components/reports/PlatformHealthReport';
import AuditTrailReport from '@/components/reports/AuditTrailReport';
import EmailDeliveryReport from '@/components/reports/EmailDeliveryReport';

const TABS = [
  { id: 'r08', label: 'R-08 Platform Health', icon: '📊', adminOnly: true },
  { id: 'r01', label: 'R-01 Completion',       icon: '✅' },
  { id: 'r02', label: 'R-02 Points',           icon: '💰' },
  { id: 'r03', label: 'R-03 Rewards',          icon: '🎁' },
  { id: 'r04', label: 'R-04 Engagement',       icon: '🔥' },
  { id: 'r05', label: 'R-05 Achievement',      icon: '🏆' },
  { id: 'r06', label: 'R-06 Leaderboard',      icon: '🥇' },
  { id: 'r07', label: 'R-07 Expiry',           icon: '⏰' },
  { id: 'r09', label: 'R-09 Audit Trail',      icon: '📋' },
  { id: 'r10', label: 'R-10 Email Delivery',   icon: '✉️' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function AdminReportsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('r08');
  const [familyId, setFamilyId] = useState('');
  const [childId, setChildId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const filters = {
    familyId: familyId || undefined,
    childId: childId || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-red-100 text-red-700 text-xs font-semibold px-2.5 py-0.5">ADMIN</span>
          <h1 className="text-xl font-bold text-gray-900">Platform Reports</h1>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">Cross-family analytics, audit trails, and platform health</p>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 pt-6 space-y-6">
        {/* Admin filters — includes family ID */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Family ID (optional)</label>
              <input
                type="text"
                placeholder="Filter by family"
                value={familyId}
                onChange={(e) => setFamilyId(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 w-52 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Child ID (optional)</label>
              <input
                type="text"
                placeholder="Filter by child"
                value={childId}
                onChange={(e) => setChildId(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 w-44 focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
            <div className="flex gap-2">
              {[{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }].map(({ label, days }) => (
                <button key={label} onClick={() => setPreset(days)}
                  className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200 transition-colors">
                  {label}
                </button>
              ))}
              <button onClick={() => { setStartDate(''); setEndDate(''); setChildId(''); setFamilyId(''); }}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition-colors">
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <div className="flex gap-1 px-4 md:px-0 min-w-max">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? tab.id === 'r08'
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}>
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {(tab as any).adminOnly && activeTab !== tab.id && (
                  <span className="ml-1 text-xs bg-red-100 text-red-600 rounded px-1">admin</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Report content */}
        <div>
          {activeTab === 'r08' && <PlatformHealthReport />}
          {activeTab === 'r01' && <TaskCompletionReport {...filters} />}
          {activeTab === 'r02' && <PointsLedgerReport {...filters} />}
          {activeTab === 'r03' && <RewardRedemptionReport {...filters} />}
          {activeTab === 'r04' && <EngagementStreakReport {...filters} />}
          {activeTab === 'r05' && <AchievementReport {...filters} />}
          {activeTab === 'r06' && <LeaderboardReport familyId={familyId || undefined} />}
          {activeTab === 'r07' && <ExpiryOverdueReport {...filters} />}
          {activeTab === 'r09' && <AuditTrailReport {...filters} />}
          {activeTab === 'r10' && <EmailDeliveryReport {...filters} />}
        </div>
      </div>
    </div>
  );
}
