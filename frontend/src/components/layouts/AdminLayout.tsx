/**
 * components/layouts/AdminLayout.tsx — M8
 *
 * Shared layout component used by app/admin/layout.tsx to wrap all admin pages.
 * Provides a sidebar with navigation links and a top bar showing the logged-in
 * admin's name.
 *
 * Route guard: if the user is authenticated but NOT an admin, they are
 * redirected to /parent/dashboard. If not authenticated, they go to /login.
 * This guard is also enforced server-side by the backend requireAdmin middleware,
 * but the frontend guard gives instant feedback without a round-trip.
 *
 * Sidebar links:
 *   Overview     /admin/dashboard
 *   Families     /admin/families
 *   Users        /admin/users
 *   Achievements /admin/achievements
 *   Audit Log    /admin/audit-log
 *  Emails       /admin/emails
 */

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// Nav item shape
interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview',     href: '/admin/dashboard',    icon: '📊' },
  { label: 'Families',     href: '/admin/families',     icon: '🏠' },
  { label: 'Users',        href: '/admin/users',        icon: '👥' },
  { label: 'Achievements', href: '/admin/achievements', icon: '🏆' },
  { label: 'Audit Log',    href: '/admin/audit-log',    icon: '📋' },
  // M9 — Email log viewer + resend (live)
  { label: 'Emails',       href: '/admin/emails',       icon: '✉️' },
];

interface AdminLayoutProps {
  children: React.ReactNode;
  /** Optional title shown in the top bar next to the logo */
  pageTitle?: string;
}

export default function AdminLayout({ children, pageTitle }: AdminLayoutProps) {
  const { user, isLoading, isAuthenticated, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // ── Route guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    // Non-admin users who land on /admin/* get bounced to their own dashboard
    if (!isAdmin) {
      router.replace(user?.role === 'child' ? '/child/dashboard' : '/parent/dashboard');
    }
  }, [isLoading, isAuthenticated, isAdmin, user, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-slate-400 text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  if (!isAdmin) return null; // Prevent flash while redirecting

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside className="w-60 shrink-0 bg-slate-900 text-white flex flex-col">
        {/* Logo / brand */}
        <div className="px-5 py-6 border-b border-slate-700">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
            TaskBuddy
          </div>
          <div className="text-lg font-bold text-white">Admin Panel</div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <ul className="space-y-1 px-3">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname.startsWith(item.href);

              return (
                <li key={item.href}>
                  {item.disabled ? (
                    // Disabled items shown greyed out with a "Soon" badge
                    <span className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 cursor-not-allowed text-sm">
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                      <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">
                        M9
                      </span>
                    </span>
                  ) : (
                    <Link
                      href={item.href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? 'bg-indigo-600 text-white font-medium'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-1.5 min-w-[20px] text-center">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Admin user info + logout */}
        <div className="px-4 py-4 border-t border-slate-700">
          <div className="text-xs text-slate-400 mb-1">Signed in as</div>
          <div className="text-sm font-medium text-white truncate">
            {user?.firstName} {user?.lastName}
          </div>
          <Link
            href="/login"
            className="mt-3 block text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Sign out
          </Link>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-800">
            {pageTitle || 'Admin'}
          </h1>
          <div className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
            Admin
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}