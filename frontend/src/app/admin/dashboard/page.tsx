/**
 * app/admin/dashboard/page.tsx — M8
 *
 * Platform overview page. The first thing an admin sees after login.
 * Shows five key health stats fetched from GET /admin/overview:
 *   - Total families registered
 *   - Total users (all roles)
 *   - DAU — distinct logins in the last 7 days
 *   - Pending approvals across all families (completed assignments awaiting review)
 *   - New family registrations this week
 *
 * Acceptance test T2:
 *   "Admin lands on /admin/dashboard. The overview shows correct counts of
 *    total families and users (matches DB)."
 */

'use client';

import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';

interface OverviewData {
  totalFamilies: number;
  totalUsers: number;
  dau: number;
  pendingApprovals: number;
  newRegistrationsThisWeek: number;
}

interface StatCardProps {
  label: string;
  value: number | string;
  icon: string;
  description?: string;
  accent?: string;
}

function StatCard({ label, value, icon, description, accent = 'bg-indigo-50' }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${accent} flex items-center justify-center text-lg`}>
          {icon}
        </div>
      </div>
      <div className="text-2xl font-bold text-slate-800 mb-0.5">{value}</div>
      <div className="text-sm font-medium text-slate-600">{label}</div>
      {description && (
        <div className="text-xs text-slate-400 mt-1">{description}</div>
      )}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await adminApi.getOverview();
        setOverview(res.data as OverviewData);
      } catch {
        setError('Failed to load platform stats. Please refresh.');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-slate-800">Platform Overview</h2>
        <p className="text-slate-500 text-sm mt-1">
          Live stats across all families. Refreshes on page load.
        </p>
      </div>

      {error && (
        <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        // Skeleton loader
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="w-10 h-10 bg-slate-100 rounded-lg mb-3" />
              <div className="h-7 w-16 bg-slate-100 rounded mb-1" />
              <div className="h-4 w-28 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
      ) : overview ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          <StatCard
            label="Total Families"
            value={overview.totalFamilies.toLocaleString()}
            icon="🏠"
            accent="bg-blue-50"
            description="All registered family accounts"
          />
          <StatCard
            label="Total Users"
            value={overview.totalUsers.toLocaleString()}
            icon="👥"
            accent="bg-purple-50"
            description="Parents + children across all families"
          />
          <StatCard
            label="Active Users (7 days)"
            value={overview.dau.toLocaleString()}
            icon="📈"
            accent="bg-green-50"
            description="Distinct logins in the last 7 days"
          />
          <StatCard
            label="Pending Approvals"
            value={overview.pendingApprovals.toLocaleString()}
            icon="⏳"
            accent={overview.pendingApprovals > 0 ? 'bg-amber-50' : 'bg-slate-50'}
            description="Completed tasks awaiting parent review"
          />
          <StatCard
            label="New This Week"
            value={overview.newRegistrationsThisWeek.toLocaleString()}
            icon="🆕"
            accent="bg-indigo-50"
            description="Family registrations in the last 7 days"
          />
        </div>
      ) : null}

      {/* Quick nav shortcuts */}
      {!isLoading && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Quick Access
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'View Families', href: '/admin/families', icon: '🏠' },
              { label: 'Search Users',  href: '/admin/users',    icon: '👥' },
              { label: 'Audit Log',     href: '/admin/audit-log', icon: '📋' },
              { label: 'Achievements',  href: '/admin/achievements', icon: '🏆' },
            ].map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-2 text-sm font-medium text-slate-700 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
              >
                <span>{item.icon}</span>
                {item.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
