/**
 * components/layouts/AdminLayout.tsx — M8 (updated M10)
 *
 * Shared layout for all admin pages.
 * Reports nav item added (M10 — admin/reports page).
 *
 * Sidebar links:
 *   Overview     /admin/dashboard
 *   Families     /admin/families
 *   Users        /admin/users
 *   Achievements /admin/achievements
 *   Reports      /admin/reports      ← M10 addition
 *   Audit Log    /admin/audit-log
 *   Emails       /admin/emails
 */

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

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
  { label: 'Reports',      href: '/admin/reports',      icon: '📈' },
  { label: 'Audit Log',    href: '/admin/audit-log',    icon: '📋' },
  { label: 'Emails',       href: '/admin/emails',       icon: '✉️' },
];

interface AdminLayoutProps {
  children: React.ReactNode;
  pageTitle?: string;
}

export default function AdminLayout({ children, pageTitle }: AdminLayoutProps) {
  const { user, isLoading, isAuthenticated, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
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

  if (!isAdmin) return null;

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 bg-slate-900 text-white flex flex-col">
        {/* Brand */}
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
                    <span className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 cursor-not-allowed text-sm">
                      <span>{item.icon}</span>
                      <span>{item.label}</span>
                      <span className="ml-auto text-xs bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">
                        Soon
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

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-slate-800">
            {pageTitle || 'Admin'}
          </h1>
          <div className="text-xs text-slate-400 bg-slate-100 px-3 py-1 rounded-full">
            Admin
          </div>
        </header>
        <main className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}