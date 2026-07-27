'use client';

/**
 * components/admin/RecentPanels.tsx
 *
 * "Latest N" panels for the admin area, used on three pages: the dashboard shows both, and the
 * Families and Users pages each show their own above the searchable list.
 *
 * Each panel fetches its own data rather than reading the host page's list. On /admin/families the
 * list below is filtered and paginated by the admin, so deriving "latest 10" from it would make the
 * panel change when they search — the panel is meant to be a stable reference point.
 *
 * Newest-first is already the server's default ordering on both endpoints, so the newest N rows are
 * simply page 1.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { AdminFamilyRow, AdminUserRow } from '@taskbuddy/shared';
import { adminApi } from '@/lib/api';

/** How many rows the panels show. */
export const RECENT_LIMIT = 10;

function formatDate(value: Date | string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function Panel({
  title,
  href,
  isLoading,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  href: string;
  isLoading: boolean;
  isEmpty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
        <h3 className="font-semibold text-slate-800">{title}</h3>
        <a href={href} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          View all
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

function Row({ href, primary, secondary, date }: {
  href: string;
  primary: string;
  secondary: string;
  date: Date | string;
}) {
  return (
    <li className="px-5 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <a href={href} className="font-medium text-slate-800 hover:text-indigo-600 truncate block">
          {primary}
        </a>
        <p className="text-xs text-slate-400 truncate">{secondary}</p>
      </div>
      <span className="text-xs text-slate-400 shrink-0">{formatDate(date)}</span>
    </li>
  );
}

export function RecentFamiliesPanel() {
  const [families, setFamilies] = useState<AdminFamilyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    adminApi
      .getFamilies({ limit: RECENT_LIMIT })
      .then((res) => setFamilies(res.data?.families ?? []))
      // Non-fatal: whatever the host page shows below stays useful without this panel.
      .catch(() => setFamilies([]))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <Panel
      title={`Latest ${RECENT_LIMIT} Families`}
      href="/admin/families"
      isLoading={isLoading}
      isEmpty={families.length === 0}
      emptyText="No families registered yet."
    >
      {families.map((family) => (
        <Row
          key={family.id}
          href={`/admin/families/${family.id}`}
          primary={family.familyName}
          secondary={`${family._count.users} ${family._count.users === 1 ? 'member' : 'members'}${
            family.isSuspended ? ' · Suspended' : ''
          }`}
          date={family.createdAt}
        />
      ))}
    </Panel>
  );
}

export function RecentUsersPanel() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    adminApi
      .getUsers({ limit: RECENT_LIMIT })
      .then((res) => setUsers(res.data?.users ?? []))
      .catch(() => setUsers([]))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <Panel
      title={`Latest ${RECENT_LIMIT} Users`}
      href="/admin/users"
      isLoading={isLoading}
      isEmpty={users.length === 0}
      emptyText="No users registered yet."
    >
      {users.map((u) => (
        <Row
          key={u.id}
          href={`/admin/users/${u.id}`}
          primary={`${u.firstName} ${u.lastName}`}
          secondary={`${u.role}${u.family?.familyName ? ` · ${u.family.familyName}` : ''}`}
          date={u.createdAt}
        />
      ))}
    </Panel>
  );
}
