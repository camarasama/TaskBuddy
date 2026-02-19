'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Users,
  CheckCircle2,
  Clock,
  TrendingUp,
  ChevronRight,
  Plus,
  Trophy,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { dashboardApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, getInitials, formatPoints } from '@/lib/utils';
import Link from 'next/link';
import { ParentLayout } from '@/components/layouts/ParentLayout';

interface ChildSummary {
  id: string;
  firstName?: string;
  lastName?: string;
  level?: number;
  totalPoints?: number;
  currentStreak?: number;
  tasksCompletedToday?: number;
  tasksPendingApproval?: number;
}

interface ParentSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  isPrimaryParent: boolean;
}

interface DashboardData {
  family: {
    id: string;
    familyName: string;
    // Total active members = parents + children
    memberCount: number;
  };
  parents: ParentSummary[];
  children: ChildSummary[];
  pendingApprovals: number;
  weeklyStats: {
    tasksCompleted: number;
    tasksCreated: number;
    pointsAwarded: number;
    rewardsRedeemed: number;
  };
}

const defaultData: DashboardData = {
  family: { id: '', familyName: 'Your Family', memberCount: 0 },
  parents: [],
  children: [],
  pendingApprovals: 0,
  weeklyStats: { tasksCompleted: 0, tasksCreated: 0, pointsAwarded: 0, rewardsRedeemed: 0 },
};

export default function ParentDashboardPage() {
  const { user } = useAuth();
  const { error: showError } = useToast();
  const [data, setData] = useState<DashboardData>(defaultData);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        const response = await dashboardApi.getParentDashboard();
        const apiData = response.data as {
          family?: { id: string; familyName: string };
          parents?: ParentSummary[];
          children?: Array<{
            user: { id: string; firstName?: string; lastName?: string };
            profile?: { level?: number; totalXp?: number; pointsBalance?: number; currentStreakDays?: number };
            completedToday?: number;
            pendingApproval?: number;
          }>;
          weeklyStats?: { tasksCompleted?: number; pointsEarned?: number; rewardsRedeemed?: number };
          pendingApprovals?: unknown[];
        };

        // Map children from API format to frontend format
        const mappedChildren: ChildSummary[] = (apiData.children || []).map((child) => ({
          id: child.user?.id || '',
          firstName: child.user?.firstName,
          lastName: child.user?.lastName,
          level: child.profile?.level ?? 1,
          totalPoints: child.profile?.pointsBalance ?? 0,
          currentStreak: child.profile?.currentStreakDays ?? 0,
          tasksCompletedToday: child.completedToday ?? 0,
          tasksPendingApproval: child.pendingApproval ?? 0,
        }));

        const mappedParents: ParentSummary[] = apiData.parents || [];

        // Total members = all active parents + all children
        const memberCount = mappedParents.length + mappedChildren.length;

        setData({
          ...defaultData,
          family: {
            id: apiData.family?.id || '',
            familyName: apiData.family?.familyName || 'Your Family',
            memberCount,
          },
          parents: mappedParents,
          children: mappedChildren,
          pendingApprovals: apiData.pendingApprovals?.length ?? 0,
          weeklyStats: {
            tasksCompleted: apiData.weeklyStats?.tasksCompleted ?? 0,
            tasksCreated: 0,
            pointsAwarded: apiData.weeklyStats?.pointsEarned ?? 0,
            rewardsRedeemed: apiData.weeklyStats?.rewardsRedeemed ?? 0,
          },
        });
      } catch {
        showError('Failed to load dashboard');
        setData(defaultData);
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboard();
  }, [showError]);

  if (isLoading) {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
        </div>
      </ParentLayout>
    );
  }

  return (
    <ParentLayout>
      <div className="space-y-8">
        {/* Welcome Header */}
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">
            Welcome back, {user?.firstName}!
          </h1>
          <p className="text-slate-600 mt-1">
            Here&apos;s what&apos;s happening with the {data.family.familyName} family
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Users}
            label="Family Members"
            value={data.family.memberCount}
            color="primary"
          />
          <StatCard
            icon={Clock}
            label="Pending Approvals"
            value={data.pendingApprovals}
            color="warning"
            href="/parent/tasks?tab=pending"
          />
          <StatCard
            icon={CheckCircle2}
            label="Tasks This Week"
            value={data.weeklyStats.tasksCompleted}
            color="success"
          />
          <StatCard
            icon={Star}
            label="Points Awarded"
            value={formatPoints(data.weeklyStats.pointsAwarded)}
            color="gold"
          />
        </div>

        {/* Children Overview */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold text-slate-900">
              Your Children
            </h2>
            <Link href="/parent/children">
              <Button variant="ghost" size="sm">
                <Plus className="w-4 h-4" />
                Add Child
              </Button>
            </Link>
          </div>

          {data.children.length === 0 ? (
            <EmptyChildrenCard />
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.children.map((child, index) => (
                <ChildCard key={child.id || `child-${index}`} child={child} />
              ))}
            </div>
          )}
        </section>

        {/* Quick Actions */}
        <section>
          <h2 className="font-display text-xl font-bold text-slate-900 mb-4">
            Quick Actions
          </h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <QuickActionCard
              href="/parent/tasks/new"
              icon={Plus}
              title="Create Task"
              description="Assign a new task"
              color="primary"
            />
            <QuickActionCard
              href="/parent/rewards/new"
              icon={Trophy}
              title="Add Reward"
              description="Create a new reward"
              color="gold"
            />
            <QuickActionCard
              href="/parent/tasks?tab=pending"
              icon={Clock}
              title="Review Tasks"
              description={`${data.pendingApprovals} pending`}
              color="warning"
            />
            <QuickActionCard
              href="/parent/children"
              icon={Users}
              title="Manage Family"
              description="Add or edit members"
              color="xp"
            />
          </div>
        </section>

        {/* Weekly Summary */}
        <section className="bg-gradient-to-br from-primary-50 to-xp-50 rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-primary-600" />
            <h2 className="font-display text-xl font-bold text-slate-900">
              This Week&apos;s Summary
            </h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-sm text-slate-600">Tasks Completed</p>
              <p className="text-2xl font-bold text-slate-900">
                {data.weeklyStats.tasksCompleted}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Tasks Created</p>
              <p className="text-2xl font-bold text-slate-900">
                {data.weeklyStats.tasksCreated}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Points Awarded</p>
              <p className="text-2xl font-bold text-gold-600">
                {formatPoints(data.weeklyStats.pointsAwarded)}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-600">Rewards Redeemed</p>
              <p className="text-2xl font-bold text-xp-600">
                {data.weeklyStats.rewardsRedeemed}
              </p>
            </div>
          </div>
        </section>
      </div>
    </ParentLayout>
  );
}

// Stat Card Component
function StatCard({
  icon: Icon,
  label,
  value,
  color,
  href,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: 'primary' | 'success' | 'warning' | 'gold' | 'xp';
  href?: string;
}) {
  const colorClasses = {
    primary: 'bg-primary-100 text-primary-600',
    success: 'bg-success-100 text-success-600',
    warning: 'bg-warning-100 text-warning-600',
    gold: 'bg-gold-100 text-gold-600',
    xp: 'bg-xp-100 text-xp-600',
  };

  const content = (
    <div className="bg-white rounded-xl p-4 border border-slate-200 hover:border-slate-300 transition-colors">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', colorClasses[color])}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-600">{label}</p>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

// Child Card Component
function ChildCard({ child }: { child: ChildSummary }) {
  const displayName = child.firstName || child.lastName || 'Child';
  const level = child.level ?? 1;
  const currentStreak = child.currentStreak ?? 0;
  const tasksCompletedToday = child.tasksCompletedToday ?? 0;
  const tasksPendingApproval = child.tasksPendingApproval ?? 0;

  return (
    <Link href={`/parent/children/${child.id}`}>
      <motion.div
        whileHover={{ scale: 1.02 }}
        className="bg-white rounded-xl p-5 border border-slate-200 hover:border-primary-300 hover:shadow-md transition-all"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold">
              {getInitials(child.firstName, child.lastName)}
            </div>
            <div>
              <h3 className="font-bold text-slate-900">{displayName}</h3>
              <p className="text-sm text-slate-500">Level {level}</p>
            </div>
          </div>
          {currentStreak > 0 && (
            <div className="flex items-center gap-1 text-orange-500 text-sm font-medium">
              <span>🔥</span>
              <span>{currentStreak}</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-slate-50 rounded-lg p-2">
            <p className="text-lg font-bold text-slate-900">{tasksCompletedToday}</p>
            <p className="text-xs text-slate-500">Today</p>
          </div>
          <div className="bg-gold-50 rounded-lg p-2">
            <p className="text-lg font-bold text-gold-600">{formatPoints(child.totalPoints)}</p>
            <p className="text-xs text-slate-500">Points</p>
          </div>
          <div className="bg-warning-50 rounded-lg p-2">
            <p className="text-lg font-bold text-warning-600">{tasksPendingApproval}</p>
            <p className="text-xs text-slate-500">Pending</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm text-primary-600 font-medium">
          <span>View Details</span>
          <ChevronRight className="w-4 h-4" />
        </div>
      </motion.div>
    </Link>
  );
}

// Empty Children Card
function EmptyChildrenCard() {
  return (
    <div className="bg-white rounded-xl p-8 border-2 border-dashed border-slate-200 text-center">
      <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 rounded-full flex items-center justify-center">
        <Users className="w-8 h-8 text-slate-400" />
      </div>
      <h3 className="font-bold text-slate-900 mb-2">No children yet</h3>
      <p className="text-slate-600 mb-4">
        Add your first child to start assigning tasks
      </p>
      <Link href="/parent/children">
        <Button>
          <Plus className="w-4 h-4" />
          Add Child
        </Button>
      </Link>
    </div>
  );
}

// Quick Action Card
function QuickActionCard({
  href,
  icon: Icon,
  title,
  description,
  color,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  description: string;
  color: 'primary' | 'success' | 'warning' | 'gold' | 'xp';
}) {
  const colorClasses = {
    primary: 'from-primary-500 to-primary-600',
    success: 'from-success-500 to-success-600',
    warning: 'from-warning-500 to-warning-600',
    gold: 'from-gold-500 to-gold-600',
    xp: 'from-xp-500 to-xp-600',
  };

  return (
    <Link href={href}>
      <motion.div
        whileHover={{ scale: 1.02 }}
        className={cn(
          'bg-gradient-to-br text-white rounded-xl p-5 hover:shadow-lg transition-all',
          colorClasses[color]
        )}
      >
        <Icon className="w-8 h-8 mb-3 opacity-90" />
        <h3 className="font-bold mb-1">{title}</h3>
        <p className="text-sm opacity-90">{description}</p>
      </motion.div>
    </Link>
  );
}