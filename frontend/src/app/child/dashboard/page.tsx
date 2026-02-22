'use client';

/**
 * child/dashboard/page.tsx — Updated M10 Phase 6 (Real-time Socket Engagement)
 *
 * Changes from M7 (everything else is unchanged from the original):
 *  - ChildDashboardData.profile: added optional totalXpEarned field
 *  - XP bar now uses totalXpEarned (not experiencePoints alone) for level calc
 *  - Added a gold "Points" balance card displayed alongside the existing XP card
 *  - Added LevelUpCelebration modal — fires when API returns a pending levelUp
 *  - Imported XpProgressBar and LevelUpCelebration components
 *
 * M7 display rules (CR-06):
 *  - Points (gold)  = spendable currency for rewards — shown as a separate balance card
 *  - XP    (purple) = level progression, NEVER spent — existing XP bar preserved
 *  - Redeeming a reward only decrements Points, never XP
 */

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  Trophy,
  Star,
  Zap,
  ChevronRight,
  Gift,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { dashboardApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, formatPoints, getDifficultyColor, levelFromXp } from '@/lib/utils';
import Link from 'next/link';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { useSocket } from '@/contexts/SocketContext';
// M7 — CR-06: New components for dual currency display and level-up celebration
import { XpProgressBar } from '@/components/ui/XpProgressBar';
import { LevelUpCelebration } from '@/components/LevelUpCelebration';
// M10 — Phase 6: Real-time engagement toasts
import { AchievementToast } from '@/components/AchievementToast';
import { StreakMilestoneToast, isStreakMilestone } from '@/components/StreakMilestoneToast';

interface TaskAssignment {
  assignment: {
    id: string;
    status: string;
  };
  task: {
    id: string;
    title: string;
    description?: string;
    difficulty: string;
    pointsValue: number;
  };
}

interface Achievement {
  achievement: {
    id: string;
    name: string;
    description: string;
    iconUrl?: string;
  };
  unlockedAt: string;
}

interface ChildDashboardData {
  profile: {
    level: number;
    experiencePoints: number;
    // M7 — CR-06: totalXpEarned is the lifetime XP accumulator that drives
    // level calculation. NEVER decremented. experiencePoints is the within-level
    // bar value. Falls back to experiencePoints if API not yet updated.
    totalXpEarned?: number;
    pointsBalance: number;
    totalPointsEarned: number;
    currentStreakDays: number;
    longestStreakDays: number;
    totalTasksCompleted: number;
  };
  todaysTasks: TaskAssignment[];
  streak: {
    current: number;
    atRisk: boolean;
    completedToday: number;
    requiredDaily: number;
  };
  recentAchievements: Achievement[];
  dailyChallenge?: {
    id: string;
    title: string;
    description?: string;
    bonusPoints: number;
    progress: number;
    target: number;
    completed: boolean;
  };
  nextReward?: {
    reward: {
      id: string;
      name: string;
      pointsCost: number;
    };
    pointsNeeded: number;
  };
}

export default function ChildDashboardPage() {
  const { user } = useAuth();
  const { error: showError } = useToast();
  const [data, setData] = useState<ChildDashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // M7 — CR-06: Level-up celebration state (also updated via socket in M10)
  const [levelUpState, setLevelUpState] = useState<{
    show: boolean;
    newLevel: number;
    bonusPoints: number;
  }>({ show: false, newLevel: 1, bonusPoints: 0 });

  // M10 — Phase 6: Real-time socket state
  const { socket } = useSocket();

  // Live points balance — socket pushes updates when tasks are approved or rewards redeemed
  const [livePoints, setLivePoints] = useState<number | null>(null);

  // Achievement toast — fires when server emits achievement:unlocked
  const [achievementToast, setAchievementToast] = useState<{
    show: boolean;
    achievementName: string;
  }>({ show: false, achievementName: '' });

  // Streak milestone toast — fires when streak reaches a milestone (7, 14, 30, 60, 100…)
  const [streakToast, setStreakToast] = useState<{
    show: boolean;
    streakDays: number;
  }>({ show: false, streakDays: 0 });

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const response = await dashboardApi.getChildDashboard();
        const apiData = response.data as unknown as ChildDashboardData & {
          // M7: approval endpoint returns levelUp; dashboard may relay it
          levelUp?: {
            leveledUp: boolean;
            newLevel: number;
            bonusPointsAwarded: number;
          };
        };

        setData(apiData);

        // M7 — CR-06: Show celebration if a level-up happened since last load
        if (apiData.levelUp?.leveledUp) {
          setLevelUpState({
            show: true,
            newLevel: apiData.levelUp.newLevel,
            bonusPoints: apiData.levelUp.bonusPointsAwarded,
          });
        }

        // M10 — Phase 6: Show streak milestone toast on first load if applicable
        const streak = apiData.streak?.current ?? apiData.profile?.currentStreakDays ?? 0;
        if (streak > 0 && isStreakMilestone(streak)) {
          setStreakToast({ show: true, streakDays: streak });
        }
      } catch {
        showError('Failed to load dashboard');
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboard();
  }, [showError]);

  // M10 — Phase 6: Real-time socket event handlers
  useEffect(() => {
    if (!socket) return;

    // points:updated — live balance when parent approves task or child redeems reward
    const handlePoints = (payload: { childId: string; newBalance: number }) => {
      const myId = (user as any)?.id;
      if (myId && payload.childId !== myId) return; // guard: only my events
      setLivePoints(payload.newBalance);
      // Also patch dashboard data so the Points card re-renders correctly
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          profile: { ...prev.profile, pointsBalance: payload.newBalance },
        };
      });
    };

    // level:up — show the celebration modal in real-time (without page refresh)
    const handleLevelUp = (payload: { childId: string; newLevel: number; bonusPoints: number }) => {
      const myId = (user as any)?.id;
      if (myId && payload.childId !== myId) return;
      setLevelUpState({ show: true, newLevel: payload.newLevel, bonusPoints: payload.bonusPoints });
    };

    // achievement:unlocked — show achievement toast
    const handleAchievement = (payload: { childId: string; achievementName: string }) => {
      const myId = (user as any)?.id;
      if (myId && payload.childId !== myId) return;
      setAchievementToast({ show: true, achievementName: payload.achievementName });
    };

    // task:approved — refresh task statuses so the progress ring updates
    const handleTaskApproved = (payload: { childId: string; pointsAwarded: number }) => {
      const myId = (user as any)?.id;
      if (myId && payload.childId !== myId) return;
      // Re-fetch dashboard to get updated task statuses (lightweight)
      dashboardApi.getChildDashboard()
        .then((res) => {
          const d = res.data as unknown as ChildDashboardData;
          setData((prev) => ({
            ...prev!,
            todaysTasks: d.todaysTasks ?? prev?.todaysTasks ?? [],
            streak: d.streak ?? prev?.streak ?? { current: 0, atRisk: false, completedToday: 0, requiredDaily: 1 },
          }));
        })
        .catch(() => {}); // non-fatal
    };

    socket.on('points:updated', handlePoints);
    socket.on('level:up', handleLevelUp);
    socket.on('achievement:unlocked', handleAchievement);
    socket.on('task:approved', handleTaskApproved);

    return () => {
      socket.off('points:updated', handlePoints);
      socket.off('level:up', handleLevelUp);
      socket.off('achievement:unlocked', handleAchievement);
      socket.off('task:approved', handleTaskApproved);
    };
  }, [socket, user]);

  if (isLoading) {
    return (
      <ChildLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-xp-500 border-t-transparent" />
        </div>
      </ChildLayout>
    );
  }

  // Use default data if API fails
  const dashboardData = data || {
    profile: {
      level: 1,
      experiencePoints: 0,
      totalXpEarned: 0,
      pointsBalance: 0,
      totalPointsEarned: 0,
      currentStreakDays: 0,
      longestStreakDays: 0,
      totalTasksCompleted: 0,
    },
    todaysTasks: [],
    streak: { current: 0, atRisk: false, completedToday: 0, requiredDaily: 1 },
    recentAchievements: [],
    dailyChallenge: undefined,
    nextReward: undefined,
  };

  // M7 — CR-06: Use totalXpEarned for level calculation if available.
  const totalXp = dashboardData.profile.totalXpEarned ?? dashboardData.profile.experiencePoints ?? 0;
  const { level, currentXp, nextLevelXp } = levelFromXp(totalXp);
  const xpProgress = (currentXp / nextLevelXp) * 100;

  // M10 — Phase 6: Use live socket balance if available, fall back to API data
  const displayPoints = livePoints !== null ? livePoints : (dashboardData.profile.pointsBalance ?? 0);

  const streakDays = dashboardData.profile.currentStreakDays ?? dashboardData.streak?.current ?? 0;
  const completedTasks = dashboardData.todaysTasks.filter(t => {
    const status = t.assignment?.status || '';
    return status === 'completed' || status === 'approved';
  }).length;
  const totalTasks = dashboardData.todaysTasks.length;

  return (
    <ChildLayout>
      {/* M7 — CR-06: Level-up celebration modal */}
      <LevelUpCelebration
        isOpen={levelUpState.show}
        onClose={() => setLevelUpState((s) => ({ ...s, show: false }))}
        newLevel={levelUpState.newLevel}
        bonusPoints={levelUpState.bonusPoints}
      />

      {/* M10 — Phase 6: Achievement unlocked toast */}
      <AchievementToast
        show={achievementToast.show}
        achievementName={achievementToast.achievementName}
        onDismiss={() => setAchievementToast((s) => ({ ...s, show: false }))}
      />

      {/* M10 — Phase 6: Streak milestone toast */}
      <StreakMilestoneToast
        show={streakToast.show}
        streakDays={streakToast.streakDays}
        onDismiss={() => setStreakToast((s) => ({ ...s, show: false }))}
      />

      <div className="space-y-6">
        {/* Welcome & Streak */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">
            Hey {user?.firstName}! 👋
          </h1>
          {streakDays > 0 && (
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-400 to-red-500 text-white rounded-full font-bold">
              <span className="text-xl">🔥</span>
              <span>{streakDays} day streak!</span>
            </div>
          )}
        </motion.div>

        {/* ── M7: Dual Currency Row ──────────────────────────────────────────
          Two side-by-side cards replace the old single-currency display:
            Left  — Gold Points card  (spendable, used for rewards)
            Right — Purple XP card   (level progression, never spent)
          The larger level card below is kept and now clearly labels
          its value as "Total XP" to distinguish it from Points.
        */}
        <div className="grid grid-cols-2 gap-3">

          {/* Gold Points card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-gradient-to-br from-gold-400 to-gold-600 rounded-2xl p-5 text-white shadow-lg shadow-gold-500/30"
          >
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-5 h-5 opacity-90" />
              <span className="text-sm font-semibold uppercase tracking-wide opacity-90">
                Points
              </span>
            </div>
            <p className="text-3xl font-bold leading-none mb-1">
              {displayPoints.toLocaleString()}
            </p>
            <p className="text-xs opacity-75">Spend on rewards</p>
          </motion.div>

          {/* Purple XP card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-gradient-to-br from-xp-500 to-xp-700 rounded-2xl p-5 text-white shadow-lg shadow-xp-500/30"
          >
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 opacity-90" />
              <span className="text-sm font-semibold uppercase tracking-wide opacity-90">
                Level {level}
              </span>
            </div>
            <XpProgressBar
              level={level}
              currentLevelXp={currentXp}
              xpToNextLevel={nextLevelXp}
              totalXpEarned={totalXp}
              size="sm"
              showLabel={false}
            />
            <p className="text-xs opacity-75 mt-2">
              {currentXp}/{nextLevelXp} XP
            </p>
          </motion.div>
        </div>

        {/* Level Progress Card (original — preserved, now labelled "Total XP") */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-gradient-to-br from-xp-500 to-xp-700 rounded-2xl p-6 text-white shadow-lg shadow-xp-500/30"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                <span className="text-3xl font-bold">{level}</span>
              </div>
              <div>
                <p className="text-xp-100">Level {level}</p>
                <p className="font-bold text-lg">Task Champion</p>
              </div>
            </div>
            <div className="text-right">
              {/* M7 — CR-06: "Total XP" label makes clear this is NOT spendable Points */}
              <p className="text-xp-100">Total XP</p>
              <p className="font-bold text-xl">{totalXp.toLocaleString()}</p>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-sm mb-2">
              <span>Level {level}</span>
              <span>Level {level + 1}</span>
            </div>
            <div className="h-3 bg-white/20 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${xpProgress}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full bg-white rounded-full"
              />
            </div>
            <p className="text-center text-sm mt-2 text-xp-100">
              {nextLevelXp - currentXp} XP to next level
            </p>
          </div>
        </motion.div>

        {/* Daily Progress */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-lg text-slate-900">
              Today&apos;s Progress
            </h2>
            <span className="text-sm text-slate-500">
              {completedTasks}/{totalTasks} tasks
            </span>
          </div>

          {/* Progress Ring */}
          <div className="flex items-center justify-center mb-6">
            <div className="relative w-32 h-32">
              <svg className="w-full h-full -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  fill="none"
                  stroke="#e2e8f0"
                  strokeWidth="12"
                />
                <motion.circle
                  cx="64"
                  cy="64"
                  r="56"
                  fill="none"
                  stroke="url(#progressGradient)"
                  strokeWidth="12"
                  strokeLinecap="round"
                  initial={{ strokeDasharray: '0 352' }}
                  animate={{
                    strokeDasharray: `${(completedTasks / Math.max(totalTasks, 1)) * 352} 352`,
                  }}
                  transition={{ duration: 1, ease: 'easeOut' }}
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#22c55e" />
                    <stop offset="100%" stopColor="#16a34a" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-slate-900">{completedTasks}</span>
                <span className="text-sm text-slate-500">done</span>
              </div>
            </div>
          </div>

          {totalTasks === 0 ? (
            <p className="text-center text-slate-500">No tasks for today!</p>
          ) : completedTasks === totalTasks ? (
            <div className="text-center">
              <p className="text-success-600 font-bold mb-2">All done! Great job! 🎉</p>
            </div>
          ) : (
            <Link href="/child/tasks">
              <Button fullWidth variant="primary">
                <Zap className="w-4 h-4" />
                Continue Tasks
              </Button>
            </Link>
          )}
        </motion.div>

        {/* Daily Challenge */}
        {dashboardData.dailyChallenge && !dashboardData.dailyChallenge.completed && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-gradient-to-br from-gold-400 to-gold-600 rounded-2xl p-6 text-white shadow-lg shadow-gold-500/30"
          >
            <div className="flex items-center gap-2 mb-3">
              <Star className="w-5 h-5" />
              <span className="font-bold">Daily Challenge</span>
              <span className="ml-auto text-sm bg-white/20 px-2 py-1 rounded-full">
                +{dashboardData.dailyChallenge.bonusPoints} bonus points!
              </span>
            </div>
            <p className="font-bold text-lg mb-3">
              {dashboardData.dailyChallenge.title}
            </p>
            <div className="flex items-center justify-between">
              <span className="text-gold-100">
                {dashboardData.dailyChallenge.progress}/{dashboardData.dailyChallenge.target} completed
              </span>
              <ChevronRight className="w-5 h-5" />
            </div>
          </motion.div>
        )}

        {/* Today's Tasks Preview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-lg text-slate-900">
              Today&apos;s Tasks
            </h2>
            <Link href="/child/tasks" className="text-sm text-primary-600 font-medium">
              View All
            </Link>
          </div>

          {dashboardData.todaysTasks.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="w-12 h-12 text-success-400 mx-auto mb-3" />
              <p className="text-slate-600">No tasks assigned for today</p>
              <p className="text-sm text-slate-400">Enjoy your free time!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dashboardData.todaysTasks.slice(0, 3).map((item, index) => (
                <TaskPreviewCard key={item.assignment?.id || index} item={item} />
              ))}
              {dashboardData.todaysTasks.length > 3 && (
                <Link href="/child/tasks">
                  <Button variant="ghost" fullWidth size="sm">
                    View {dashboardData.todaysTasks.length - 3} more tasks
                  </Button>
                </Link>
              )}
            </div>
          )}
        </motion.div>

        {/* Next Reward */}
        {dashboardData.nextReward && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Link href="/child/rewards">
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200 hover:border-xp-300 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-xp-100 flex items-center justify-center">
                    <Gift className="w-7 h-7 text-xp-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-slate-500">Next reward</p>
                    <p className="font-bold text-slate-900">{dashboardData.nextReward.reward.name}</p>
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="w-4 h-4 text-gold-500" />
                      <span className="text-gold-600 font-medium">
                        {formatPoints(dashboardData.nextReward.reward.pointsCost)} points needed
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-400" />
                </div>
              </div>
            </Link>
          </motion.div>
        )}

        {/* Recent Achievements */}
        {dashboardData.recentAchievements.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display font-bold text-lg text-slate-900">
                Recent Badges
              </h2>
              <Link href="/child/achievements" className="text-sm text-primary-600 font-medium">
                View All
              </Link>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
              {dashboardData.recentAchievements.map((item, index) => (
                <div
                  key={item.achievement?.id || index}
                  className="flex-shrink-0 w-20 text-center"
                >
                  <div className="w-16 h-16 mx-auto rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-2xl mb-2 shadow-lg shadow-gold-500/30">
                    <Trophy className="w-8 h-8 text-white" />
                  </div>
                  <p className="text-xs font-medium text-slate-900 truncate">
                    {item.achievement?.name}
                  </p>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </ChildLayout>
  );
}

// ─── Task Preview Card ────────────────────────────────────────────────────────

function TaskPreviewCard({ item }: { item: TaskAssignment }) {
  const status = item.assignment?.status || '';
  const isCompleted = status === 'completed' || status === 'approved';
  const isPending = status === 'completed'; // completed but not yet approved

  return (
    <Link href="/child/tasks">
      <div
        className={cn(
          'flex items-center gap-4 p-4 rounded-xl transition-all shadow-sm',
          isCompleted
            ? 'bg-success-50 border border-success-200'
            : isPending
            ? 'bg-warning-50 border border-warning-200'
            : 'bg-white border border-slate-200 hover:border-slate-300 hover:shadow-md'
        )}
      >
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center',
            isCompleted
              ? 'bg-success-500 text-white'
              : isPending
              ? 'bg-warning-500 text-white'
              : 'bg-white border-2 border-slate-300'
          )}
        >
          {isCompleted ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : isPending ? (
            <Clock className="w-5 h-5" />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'font-medium truncate',
              isCompleted ? 'text-success-800' : 'text-slate-900'
            )}
          >
            {item.task?.title || 'Task'}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full font-medium',
                getDifficultyColor((item.task?.difficulty || '').toUpperCase())
              )}
            >
              {item.task?.difficulty || 'medium'}
            </span>
            {isPending && (
              <span className="text-xs text-warning-600">Waiting for approval</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 text-gold-600 font-bold">
          <Star className="w-4 h-4" />
          <span>{item.task?.pointsValue || 0}</span>
        </div>
      </div>
    </Link>
  );
}