/**
 * app/admin/families/[id]/page.tsx — M8
 *
 * Read-only detail view for a specific family. Shows:
 *  - Family metadata (name, code, status, created date)
 *  - All members with their role, activity stats, and last login
 *  - Task/reward counts and pending approval count
 *  - Suspend / Reactivate button
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi } from '@/lib/api';

interface Member {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: string;
  isActive: boolean;
  isPrimaryParent: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  childProfile: {
    pointsBalance: number;
    level: number;
    currentStreakDays: number;
    totalTasksCompleted: number;
  } | null;
}

interface FamilyDetail {
  id: string;
  familyName: string;
  familyCode: string;
  isSuspended: boolean;
  suspendedAt: string | null;
  createdAt: string;
  users: Member[];
  settings: { timezone: string; language: string } | null;
  _count: { tasks: number; rewards: number };
}

interface ActivityData {
  pendingApprovals: number;
  recentCompletionsThisWeek: number;
}

export default function AdminFamilyDetailPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const router = useRouter();
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [family, setFamily] = useState<FamilyDetail | null>(null);
  const [activity, setActivity] = useState<ActivityData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resolve params — Next.js 15 makes params a Promise in some configurations
  useEffect(() => {
    Promise.resolve(params).then((resolved) => {
      setFamilyId(resolved.id);
    });
  }, [params]);

  async function load(id: string) {
    setIsLoading(true);
    setError(null);
    try {
      const res = await adminApi.getFamily(id);
      const d = res.data as { family: FamilyDetail; activity: ActivityData };
      setFamily(d.family);
      setActivity(d.activity);
    } catch {
      setError('Failed to load family details.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (familyId) load(familyId);
  }, [familyId]);

  async function handleSuspend() {
    if (!family || !familyId) return;
    const reason = window.prompt(`Reason for suspending "${family.familyName}" (optional):`);
    if (reason === null) return;
    setActionLoading(true);
    try {
      await adminApi.suspendFamily(familyId, reason);
      if (familyId) load(familyId);
    } catch { setError('Failed to suspend family.'); }
    finally { setActionLoading(false); }
  }

  async function handleReactivate() {
    if (!family || !familyId) return;
    setActionLoading(true);
    try {
      await adminApi.reactivateFamily(familyId);
      if (familyId) load(familyId);
    } catch { setError('Failed to reactivate family.'); }
    finally { setActionLoading(false); }
  }

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-slate-100 rounded" />
        <div className="h-40 bg-slate-100 rounded-xl" />
        <div className="h-60 bg-slate-100 rounded-xl" />
      </div>
    );
  }

  if (error || !family) {
    return (
      <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
        {error || 'Family not found.'}
      </div>
    );
  }

  const parents  = family.users.filter((u) => u.role === 'parent');
  const children = family.users.filter((u) => u.role === 'child');

  return (
    <div className="space-y-6">
      {/* Back */}
      <button
        onClick={() => router.push('/admin/families')}
        className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
      >
        ← Back to Families
      </button>

      {/* Header card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-800">{family.familyName}</h2>
            <div className="text-sm text-slate-500 mt-1 font-mono">{family.familyCode}</div>
            <div className="text-xs text-slate-400 mt-1">
              Registered {new Date(family.createdAt).toLocaleDateString()}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {family.isSuspended ? (
              <>
                <span className="text-xs font-medium text-red-700 bg-red-50 px-2 py-1 rounded-full">
                  🔒 Suspended
                </span>
                <button
                  onClick={handleReactivate}
                  disabled={actionLoading}
                  className="text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {actionLoading ? '…' : 'Reactivate'}
                </button>
              </>
            ) : (
              <>
                <span className="text-xs font-medium text-green-700 bg-green-50 px-2 py-1 rounded-full">
                  ✓ Active
                </span>
                <button
                  onClick={handleSuspend}
                  disabled={actionLoading}
                  className="text-sm bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {actionLoading ? '…' : 'Suspend'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Stats row */}
        {activity && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Tasks',              value: family._count.tasks },
              { label: 'Rewards',            value: family._count.rewards },
              { label: 'Pending Approvals',  value: activity.pendingApprovals },
              { label: 'Approved This Week', value: activity.recentCompletionsThisWeek },
            ].map((stat) => (
              <div key={stat.label} className="bg-slate-50 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-slate-800">{stat.value}</div>
                <div className="text-xs text-slate-500">{stat.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Parents */}
      <MemberSection title={`Parents (${parents.length})`} members={parents} />

      {/* Children */}
      <MemberSection title={`Children (${children.length})`} members={children} showChildStats />
    </div>
  );
}

function MemberSection({
  title,
  members,
  showChildStats = false,
}: {
  title: string;
  members: Member[];
  showChildStats?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="font-semibold text-slate-700 text-sm">{title}</h3>
      </div>
      {members.length === 0 ? (
        <div className="px-5 py-6 text-sm text-slate-400 text-center">None</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="text-left px-5 py-2 font-medium">Name</th>
              {!showChildStats && <th className="text-left px-5 py-2 font-medium">Email</th>}
              {showChildStats && <th className="text-left px-5 py-2 font-medium">Level</th>}
              {showChildStats && <th className="text-left px-5 py-2 font-medium">Points</th>}
              {showChildStats && <th className="text-left px-5 py-2 font-medium">Tasks Done</th>}
              <th className="text-left px-5 py-2 font-medium">Last Login</th>
              <th className="text-left px-5 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {members.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="px-5 py-2.5 font-medium text-slate-700">
                  {m.firstName} {m.lastName}
                  {m.isPrimaryParent && (
                    <span className="ml-2 text-xs text-indigo-500 font-normal">(primary)</span>
                  )}
                </td>
                {!showChildStats && (
                  <td className="px-5 py-2.5 text-slate-500">{m.email || '—'}</td>
                )}
                {showChildStats && (
                  <>
                    <td className="px-5 py-2.5 text-slate-600">Lv {m.childProfile?.level ?? '—'}</td>
                    <td className="px-5 py-2.5 text-slate-600">{m.childProfile?.pointsBalance?.toLocaleString() ?? '—'}</td>
                    <td className="px-5 py-2.5 text-slate-600">{m.childProfile?.totalTasksCompleted ?? '—'}</td>
                  </>
                )}
                <td className="px-5 py-2.5 text-slate-400 text-xs">
                  {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-5 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${m.isActive ? 'text-green-700 bg-green-50' : 'text-slate-500 bg-slate-100'}`}>
                    {m.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}