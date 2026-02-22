'use client';

import { ReactNode, useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Home,
  ListTodo,
  Gift,
  Trophy,
  LogOut,
  CheckCircle2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { SocketProvider, useSocket } from '@/contexts/SocketContext';
import NotificationBell from '@/components/NotificationBell';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { cn, getInitials, formatPoints, levelFromXp } from '@/lib/utils';

interface ChildLayoutProps {
  children: ReactNode;
}

const navItems = [
  { href: '/child/dashboard', icon: Home, label: 'Home' },
  { href: '/child/tasks', icon: ListTodo, label: 'Tasks' },
  { href: '/child/rewards', icon: Gift, label: 'Rewards' },
  { href: '/child/achievements', icon: Trophy, label: 'Badges' },
];

export function ChildLayout({ children }: ChildLayoutProps) {
  const { user, isChild, isLoading } = useAuth();
  const router = useRouter();

  // Redirect non-children (guard must stay outside SocketProvider)
  useEffect(() => {
    if (!isLoading && !isChild) {
      router.push('/child/login');
    }
  }, [isLoading, isChild, router]);

  if (isLoading || !isChild) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-xp-50 via-white to-gold-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-xp-500 border-t-transparent" />
      </div>
    );
  }

  // SocketProvider must wrap ChildLayoutInner so useSocket() works inside it
  return (
    <SocketProvider>
      <NotificationProvider>
        <ChildLayoutInner>{children}</ChildLayoutInner>
      </NotificationProvider>
    </SocketProvider>
  );
}

// ── Inner layout — lives inside SocketProvider so can call useSocket() ────────

function ChildLayoutInner({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { socket } = useSocket();
  const pathname = usePathname();

  // M10 — Phase 6: Live points balance — updated via socket 'points:updated'
  // Initialised from user profile; refreshed without a page reload.
  const initialPoints = (user as any)?.childProfile?.pointsBalance ?? (user as any)?.profile?.pointsBalance ?? 0;
  const [livePoints, setLivePoints] = useState<number>(initialPoints);

  // Sync when the user object changes (e.g. after re-auth or refreshUser)
  useEffect(() => {
    const p = (user as any)?.childProfile?.pointsBalance ?? (user as any)?.profile?.pointsBalance ?? 0;
    setLivePoints(p);
  }, [user]);

  // Real-time points update from socket
  useEffect(() => {
    if (!socket) return;
    const handlePointsUpdated = (payload: { newBalance: number }) => {
      setLivePoints(payload.newBalance);
    };
    socket.on('points:updated', handlePointsUpdated);
    return () => { socket.off('points:updated', handlePointsUpdated); };
  }, [socket]);

  const profile = (user as any)?.childProfile ?? (user as any)?.profile;
  const points = livePoints;
  const xp = profile?.experiencePoints ?? 0;
  const streak = profile?.currentStreakDays ?? 0;

  const { level, currentXp, nextLevelXp } = levelFromXp(xp);
  const xpProgress = (currentXp / nextLevelXp) * 100;

  return (
    <div className="min-h-screen bg-gradient-to-br from-xp-50 via-white to-gold-50">
      {/* Header */}
      <header className="sticky top-0 bg-white/80 backdrop-blur-lg border-b border-slate-200 z-40">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Profile */}
            <Link href="/child/dashboard" className="flex items-center gap-3">
              <div className="relative">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold text-lg">
                  {user ? getInitials(user.firstName, user.lastName) : '?'}
                </div>
                {/* Level Badge */}
                <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-white text-xs font-bold border-2 border-white">
                  {level}
                </div>
              </div>
              <div>
                <p className="font-bold text-slate-900">{user?.firstName}</p>
                <div className="flex items-center gap-2">
                  {/* XP Progress */}
                  <div className="w-20 h-2 bg-xp-100 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${xpProgress}%` }}
                      className="h-full bg-gradient-to-r from-xp-400 to-xp-600 rounded-full"
                    />
                  </div>
                  <span className="text-xs text-slate-500">{currentXp}/{nextLevelXp} XP</span>
                </div>
              </div>
            </Link>

            {/* Stats */}
            <div className="flex items-center gap-4">
              {/* Streak */}
              {streak > 0 && (
                <div className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-orange-400 to-red-500 text-white rounded-full text-sm font-bold">
                  <span>🔥</span>
                  <span>{streak}</span>
                </div>
              )}

              {/* Points */}
              <div className="flex items-center gap-1 px-3 py-1.5 bg-gold-100 text-gold-700 rounded-full font-bold">
                <span>⭐</span>
                <span>{formatPoints(points)}</span>
              </div>
              {/* Notification Bell — M10 Phase 5 */}
              <NotificationBell />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {children}
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 safe-area-inset-bottom z-40">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center justify-around">
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex flex-col items-center gap-1 py-3 px-4 transition-colors',
                    isActive ? 'text-xp-600' : 'text-slate-400'
                  )}
                >
                  <item.icon className="w-6 h-6" />
                  <span className="text-xs font-medium">{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="activeTab"
                      className="absolute bottom-0 w-12 h-1 bg-xp-500 rounded-t-full"
                    />
                  )}
                </Link>
              );
            })}
            <button
              onClick={logout}
              className="flex flex-col items-center gap-1 py-3 px-4 text-slate-400 hover:text-slate-600 transition-colors"
            >
              <LogOut className="w-6 h-6" />
              <span className="text-xs font-medium">Exit</span>
            </button>
          </div>
        </div>
      </nav>
    </div>
  );
}