'use client';

/**
 * app/parent/reports/page.tsx — M10 Phase 4 (updated)
 *
 * Parent reports hub — 7 family-scoped reports.
 * R-08 Audit Trail and R-09 Email Delivery are ADMIN-ONLY and removed.
 */

import { useState } from 'react';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import TaskCompletionReport from '@/components/reports/TaskCompletionReport';
import PointsLedgerReport from '@/components/reports/PointsLedgerReport';
import RewardRedemptionReport from '@/components/reports/RewardRedemptionReport';
import EngagementStreakReport from '@/components/reports/EngagementStreakReport';
import AchievementReport from '@/components/reports/AchievementReport';
import LeaderboardReport from '@/components/reports/LeaderboardReport';
import ExpiryOverdueReport from '@/components/reports/ExpiryOverdueReport';

// Audit Trail and Email Delivery are admin-only — not included here.
const TABS = [
  { id: 'r01', label: 'Completion',  icon: '✅' },
  { id: 'r02', label: 'Points',      icon: '💰' },
  { id: 'r03', label: 'Rewards',     icon: '🎁' },
  { id: 'r04', label: 'Engagement',  icon: '🔥' },
  { id: 'r05', label: 'Achievement', icon: '🏆' },
  { id: 'r06', label: 'Leaderboard', icon: '🥇' },
  { id: 'r07', label: 'Expiry',      icon: '⏰' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function ReportsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('r01');
  const [childId, setChildId]     = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');

  const setPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const filters = {
    childId:   childId   || undefined,
    startDate: startDate || undefined,
    endDate:   endDate   || undefined,
  };

  return (
    <ParentLayout>
      <div className="min-h-screen bg-gray-50 pb-12">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-5">
          <h1 className="text-xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Family performance analytics and data exports</p>
        </div>

        <div className="max-w-6xl mx-auto px-4 md:px-6 pt-6 space-y-6">
          {/* Filters */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Child</label>
                <input
                  type="text"
                  placeholder="Child ID (optional)"
                  value={childId}
                  onChange={(e) => setChildId(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 w-44 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="flex gap-2">
                {[{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }].map(({ label, days }) => (
                  <button key={label} onClick={() => setPreset(days)}
                    className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-sm hover:bg-gray-200 transition-colors">
                    {label}
                  </button>
                ))}
                <button onClick={() => { setStartDate(''); setEndDate(''); setChildId(''); }}
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
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Report content */}
          <div>
            {activeTab === 'r01' && <TaskCompletionReport {...filters} />}
            {activeTab === 'r02' && <PointsLedgerReport {...filters} />}
            {activeTab === 'r03' && <RewardRedemptionReport {...filters} />}
            {activeTab === 'r04' && <EngagementStreakReport {...filters} />}
            {activeTab === 'r05' && <AchievementReport {...filters} />}
            {activeTab === 'r06' && <LeaderboardReport />}
            {activeTab === 'r07' && <ExpiryOverdueReport {...filters} />}
          </div>
        </div>
      </div>
    </ParentLayout>
  );
}