'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Home,
  ListTodo,
  Gift,
  Users,
  Settings,
  LogOut,
  CheckCircle2,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { cn, getInitials } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

interface ParentLayoutProps {
  children: ReactNode;
}

const navItems = [
  { href: '/parent/dashboard', icon: Home, label: 'Dashboard' },
  { href: '/parent/tasks', icon: ListTodo, label: 'Tasks' },
  { href: '/parent/rewards', icon: Gift, label: 'Rewards' },
  { href: '/parent/children', icon: Users, label: 'Children' },
  { href: '/parent/settings', icon: Settings, label: 'Settings' },
];

export function ParentLayout({ children }: ParentLayoutProps) {
  const { user, isParent, isLoading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Redirect non-parents
  useEffect(() => {
    if (!isLoading && !isParent) {
      router.push('/login');
    }
  }, [isLoading, isParent, router]);

  if (isLoading || !isParent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-64 lg:flex-col">
        <div className="flex flex-col flex-1 bg-white border-r border-slate-200">
          {/* Logo */}
          <div className="flex items-center gap-2 px-6 py-5 border-b border-slate-200">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <span className="font-display font-bold text-xl text-slate-900">
              TaskBuddy
            </span>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-4 py-6 space-y-1">
            {navItems.map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                icon={item.icon}
                label={item.label}
                isActive={pathname === item.href || pathname.startsWith(item.href + '/')}
              />
            ))}
          </nav>

          {/* User */}
          <div className="p-4 border-t border-slate-200">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold">
                {user ? getInitials(user.firstName, user.lastName) : '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-900 truncate">
                  {user?.firstName} {user?.lastName}
                </p>
                <p className="text-sm text-slate-500 truncate">Parent</p>
              </div>
            </div>
            <Button
              variant="ghost"
              fullWidth
              onClick={logout}
              className="justify-start text-slate-600 hover:text-slate-900"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 bg-white border-b border-slate-200 z-40">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-white" />
            </div>
            <span className="font-display font-bold text-lg text-slate-900">
              TaskBuddy
            </span>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="p-2 rounded-lg hover:bg-slate-100"
          >
            {isMobileMenuOpen ? (
              <X className="w-6 h-6 text-slate-600" />
            ) : (
              <Menu className="w-6 h-6 text-slate-600" />
            )}
          </button>
        </div>
      </header>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="lg:hidden fixed inset-0 bg-black/50 z-40"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="lg:hidden fixed inset-y-0 left-0 w-64 bg-white z-50 flex flex-col"
            >
              <div className="flex items-center gap-2 px-6 py-5 border-b border-slate-200">
                <div className="w-10 h-10 bg-gradient-to-br from-primary-400 to-primary-600 rounded-xl flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6 text-white" />
                </div>
                <span className="font-display font-bold text-xl text-slate-900">
                  TaskBuddy
                </span>
              </div>

              <nav className="flex-1 px-4 py-6 space-y-1">
                {navItems.map((item) => (
                  <NavItem
                    key={item.href}
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    isActive={pathname === item.href || pathname.startsWith(item.href + '/')}
                    onClick={() => setIsMobileMenuOpen(false)}
                  />
                ))}
              </nav>

              <div className="p-4 border-t border-slate-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold">
                    {user ? getInitials(user.firstName, user.lastName) : '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-900 truncate">
                      {user?.firstName} {user?.lastName}
                    </p>
                    <p className="text-sm text-slate-500 truncate">Parent</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  fullWidth
                  onClick={logout}
                  className="justify-start text-slate-600 hover:text-slate-900"
                >
                  <LogOut className="w-4 h-4" />
                  Log out
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="lg:pl-64 pt-16 lg:pt-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

// Nav Item Component
function NavItem({
  href,
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors',
        isActive
          ? 'bg-primary-50 text-primary-700'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      )}
    >
      <Icon className="w-5 h-5" />
      <span>{label}</span>
    </Link>
  );
}
