/**
 * app/admin/dashboard/page.tsx - M8
 *
 * Platform overview page. The first thing an admin sees after login.
 * Shows five key health stats fetched from GET /admin/overview:
 *   - Total families registered
 *   - Total users (all roles)
 *   - DAU - distinct logins in the last 7 days
 *   - Pending approvals across all families (completed assignments awaiting review)
 *   - New family registrations this week
 *
 * Acceptance test T2:
 *   "Admin lands on /admin/dashboard. The overview shows correct counts of
 *    total families and users (matches DB)."
 */

'use client';

import { useEffect, useState } from 'react';
import type { AdminFamilyRow, AdminUserRow } from '@taskbuddy/shared';
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

/** How many rows the "recent" panels show. */
const RECENT_LIMIT = 10;

function formatDate(value: Date | string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function RecentPanel({
  title,
  href,
  linkLabel,
  isLoading,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  isLoading: boolean;
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <h3 className="font-semibold text-slate-800">{title}</h3>
        <a href={href} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          {linkLabel}
        </a>
      </div>
      {isLoading ? (
        <ul className="divide-y divide-slate-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="px-5 py-3 animate-pulse">
              <div className="h-4 w-40 bg-slate-100 rounded mb-1.5" />
              <div className="h-3 w-24 bg-slate-100 rounded" />
            </li>
          ))}
        </ul>
      ) : isEmpty ? (
        <p className="px-5 py-8 text-sm text-slate-400 text-center">{emptyText}</p>
      ) : (
        // The list scrolls on short viewports so the panel never pushes the page out of reach.
        <ul className="divide-y divide-slate-100 max-h-96 overflow-y-auto">{children}</ul>
      )}
    </section>
  );
}

export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [recentFamilies, setRecentFamilies] = useState<AdminFamilyRow[]>([]);
  const [recentUsers, setRecentUsers] = useState<AdminUserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecentLoading, setIsRecentLoading] = useState(true);
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

  // Newest-first is already the server's default ordering on both endpoints, so the newest
  // RECENT_LIMIT rows are simply page 1. Fetched separately from the stats so a slow list never
  // delays the headline numbers, and a failing list never blanks them.
  useEffect(() => {
    async function loadRecent() {
      try {
        const [families, users] = await Promise.all([
          adminApi.getFamilies({ limit: RECENT_LIMIT }),
          adminApi.getUsers({ limit: RECENT_LIMIT }),
        ]);
        setRecentFamilies(families.data?.families ?? []);
        setRecentUsers(users.data?.users ?? []);
      } catch {
        // Non-fatal: the stat cards above remain useful without these panels.
        setRecentFamilies([]);
        setRecentUsers([]);
      } finally {
        setIsRecentLoading(false);
      }
    }
    loadRecent();
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

      {/* Newest families + users, so an admin sees who just arrived without leaving the page. */}
      <div className="mt-8 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <RecentPanel
          title={`Latest ${RECENT_LIMIT} Families`}
          href="/admin/families"
          linkLabel="View all"
          isLoading={isRecentLoading}
          isEmpty={recentFamilies.length === 0}
          emptyText="No families registered yet."
        >
          {recentFamilies.map((family) => (
            <li key={family.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <a
                  href={`/admin/families/${family.id}`}
                  className="font-medium text-slate-800 hover:text-indigo-600 truncate block"
                >
                  {family.familyName}
                </a>
                <p className="text-xs text-slate-400">
                  {family._count.users} {family._count.users === 1 ? 'member' : 'members'}
                  {family.isSuspended && ' · Suspended'}
                </p>
              </div>
              <span className="text-xs text-slate-400 shrink-0">{formatDate(family.createdAt)}</span>
            </li>
          ))}
        </RecentPanel>

        <RecentPanel
          title={`Latest ${RECENT_LIMIT} Users`}
          href="/admin/users"
          linkLabel="View all"
          isLoading={isRecentLoading}
          isEmpty={recentUsers.length === 0}
          emptyText="No users registered yet."
        >
          {recentUsers.map((u) => (
            <li key={u.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <a
                  href={`/admin/users/${u.id}`}
                  className="font-medium text-slate-800 hover:text-indigo-600 truncate block"
                >
                  {u.firstName} {u.lastName}
                </a>
                <p className="text-xs text-slate-400 truncate">
                  {u.role}
                  {u.family?.familyName ? ` · ${u.family.familyName}` : ''}
                </p>
              </div>
              <span className="text-xs text-slate-400 shrink-0">{formatDate(u.createdAt)}</span>
            </li>
          ))}
        </RecentPanel>
      </div>

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
