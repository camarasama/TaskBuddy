/**
 * app/admin/users/page.tsx — M8
 *
 * Cross-family user search. Searches firstName, lastName, email, and username.
 * Each row shows the user's name, role, family, last login, and a
 * "Force Reset" button that nullifies their password hash so they must
 * set a new one on next login.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { adminApi } from '@/lib/api';

interface UserRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  username: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  familyId: string;
  family: { familyName: string } | null;
  childProfile: { pointsBalance: number; level: number } | null;
}

interface PageData {
  users: UserRow[];
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 20;

const ROLE_BADGE: Record<string, string> = {
  parent: 'bg-blue-50 text-blue-700',
  child:  'bg-purple-50 text-purple-700',
  admin:  'bg-amber-50 text-amber-700',
};

export default function AdminUsersPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [resetLoading, setResetLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async (p: number, q: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await adminApi.getUsers({ page: p, limit: PAGE_SIZE, search: q || undefined });
      setData(res.data as PageData);
    } catch {
      setError('Failed to load users.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(page, search); }, [page, search, load]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  async function handleForceReset(userId: string, name: string) {
    if (!window.confirm(`Force password reset for ${name}? Their current password will stop working immediately.`)) return;

    setResetLoading(userId);
    setSuccessMsg(null);
    setError(null);
    try {
      const res = await adminApi.forcePasswordReset(userId);
      setSuccessMsg((res.data as any).message);
    } catch {
      setError(`Failed to reset password for ${name}.`);
    } finally {
      setResetLoading(null);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Users</h2>
          <p className="text-slate-500 text-sm mt-1">
            {data ? `${data.total.toLocaleString()} users across all families` : 'Loading…'}
          </p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name, email, or username…"
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
            className="text-slate-500 text-sm px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Clear
          </button>
        )}
      </form>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mb-4 p-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
          {successMsg}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Role</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Family</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Email / Username</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Last Login</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 6 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-slate-100 rounded w-24" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data?.users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No users found.
                </td>
              </tr>
            ) : (
              data?.users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {user.firstName} {user.lastName}
                    {!user.isActive && (
                      <span className="ml-2 text-xs text-slate-400">(inactive)</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ROLE_BADGE[user.role] || 'bg-slate-100 text-slate-600'}`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {user.family?.familyName || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {user.email || user.username || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {user.lastLoginAt
                      ? new Date(user.lastLoginAt).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    {/* Don't allow force-reset on admin accounts */}
                    {user.role !== 'admin' && (
                      <button
                        onClick={() =>
                          handleForceReset(user.id, `${user.firstName} ${user.lastName}`)
                        }
                        disabled={resetLoading === user.id}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        {resetLoading === user.id ? '…' : 'Force Reset'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Page {page} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
                className="px-3 py-1 rounded border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50"
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
