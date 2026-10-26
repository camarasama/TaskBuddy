/**
 * components/layouts/AdminLayout.tsx - M8 (restyled 2026-10-26 with the admin insights redesign)
 *
 * Shared layout for all admin pages: a light, grouped sidebar (Insights / Manage / Operations) on a
 * light grey ground, with the system font. On phones the sidebar stacks above the content.
 * Also the client-side role guard (redirects non-admins away).
 */

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { BrandLogo } from '@/components/ui/BrandLogo';

interface NavItem {
  label: string;
  href: string;
}

const NAV_GROUPS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Insights',
    items: [
      { label: 'Overview', href: '/admin/dashboard' },
      { label: 'Re-engagement', href: '/admin/reengagement' },
      { label: 'Funnel', href: '/admin/funnel' },
      { label: 'Reports', href: '/admin/reports' },
    ],
  },
  {
    title: 'Manage',
    items: [
      { label: 'Families', href: '/admin/families' },
      { label: 'Users', href: '/admin/users' },
      { label: 'Testers', href: '/admin/testers' },
      { label: 'Games', href: '/admin/games' },
      { label: 'Achievements', href: '/admin/achievements' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Emails', href: '/admin/emails' },
      { label: 'Security', href: '/admin/security' },
      { label: 'Audit log', href: '/admin/audit-log' },
    ],
  },
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
    <div
      className="flex flex-col md:flex-row min-h-screen bg-[#F5F5F7] text-[#1D1D1F] antialiased"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', Inter, system-ui, sans-serif" }}
    >
      <aside className="md:w-60 shrink-0 bg-white/80 md:border-r border-b md:border-b-0 border-[#E5E5EA] flex flex-col">
        <div className="px-5 py-6 flex items-center gap-2.5">
          <BrandLogo variant="mark" size={30} href="/admin/dashboard" alt="" />
          <div>
            <div className="text-[15px] font-semibold leading-tight">TaskBuddy</div>
            <div className="text-xs text-[#6E6E73]">System admin</div>
          </div>
        </div>

        <nav aria-label="Admin" className="flex-1 px-3 pb-4 overflow-y-auto flex md:flex-col gap-5 overflow-x-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-0.5 min-w-[140px] md:min-w-0">
              <span className="text-[11px] font-semibold tracking-[0.06em] uppercase text-[#6E6E73] px-2.5 pb-1.5">
                {group.title}
              </span>
              {group.items.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                    className={`block px-2.5 py-2 rounded-lg text-sm transition-colors ${
                      isActive
                        ? 'bg-[#E8F0FB] text-[#0066CC] font-semibold'
                        : 'text-[#1D1D1F] hover:bg-[#F0F0F3]'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-[#E5E5EA]">
          <div className="text-xs text-[#6E6E73] mb-0.5">Signed in as</div>
          <div className="text-sm font-medium truncate">
            {user?.firstName} {user?.lastName}
          </div>
          <Link href="/login" className="mt-2 block text-xs text-[#0066CC] hover:text-[#004C99]">
            Sign out
          </Link>
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        {pageTitle && <h1 className="text-lg font-semibold mb-4">{pageTitle}</h1>}
        {children}
      </main>
    </div>
  );
}
