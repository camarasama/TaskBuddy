/**
 * app/admin/families/page.tsx — M8
 *
 * Paginated list of all families with search and suspend/reactivate controls.
 * Each row shows family name, member count, suspension status, created date,
 * and a link to the family detail page.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { adminApi } from '@/lib/api';

interface Family {
  id: string;
  familyName: string;
  familyCode: string;
  isSuspended: boolean;
  suspendedAt: string | null;
  createdAt: string;
  _count: { users: number };
  settings: { timezone: string; language: string } | null;
}

interface PageData {
  families: Family[];
  total: number;
  totalPages: number;
}

const PAGE_SIZE = 20;

export default function AdminFamiliesPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // familyId being actioned
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number, q: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await adminApi.getFamilies({ page: p, limit: PAGE_SIZE, search: q || undefined });
      setData(res.data as PageData);
    } catch {
      setError('Failed to load families.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, search);
  }, [page, search, load]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  async function handleSuspend(familyId: string, familyName: string) {
    const reason = window.prompt(`Reason for suspending "${familyName}" (optional):`);
    if (reason === null) return; // user cancelled

    setActionLoading(familyId);
    try {
      await adminApi.suspendFamily(familyId, reason);
      load(page, search); // Refresh list
    } catch {
      setError('Failed to suspend family.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReactivate(familyId: string) {
    setActionLoading(familyId);
    try {
      await adminApi.reactivateFamily(familyId);
      load(page, search);
    } catch {
      setError('Failed to reactivate family.');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Families</h2>
          <p className="text-slate-500 text-sm mt-1">
            {data ? `${data.total.toLocaleString()} families registered` : 'Loading…'}
          </p>
        </div>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by family name…"
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

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Family</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Code</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Members</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Created</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-32" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-24" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-8" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-16" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-20" /></td>
                  <td className="px-4 py-3"><div className="h-4 bg-slate-100 rounded w-20" /></td>
                </tr>
              ))
            ) : data?.families.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No families found.
                </td>
              </tr>
            ) : (
              data?.families.map((family) => (
                <tr key={family.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {family.familyName}
                  </td>
                  <td className="px-4 py-3 text-slate-500 font-mono text-xs">
                    {family.familyCode || '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {family._count.users}
                  </td>
                  <td className="px-4 py-3">
                    {family.isSuspended ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                        🔒 Suspended
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        ✓ Active
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {new Date(family.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/families/${family.id}`}
                        className="text-indigo-600 hover:underline text-xs"
                      >
                        View
                      </Link>
                      {family.isSuspended ? (
                        <button
                          onClick={() => handleReactivate(family.id)}
                          disabled={actionLoading === family.id}
                          className="text-green-600 hover:underline text-xs disabled:opacity-50"
                        >
                          {actionLoading === family.id ? '…' : 'Reactivate'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSuspend(family.id, family.familyName)}
                          disabled={actionLoading === family.id}
                          className="text-red-600 hover:underline text-xs disabled:opacity-50"
                        >
                          {actionLoading === family.id ? '…' : 'Suspend'}
                        </button>
                      )}
                    </div>
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
