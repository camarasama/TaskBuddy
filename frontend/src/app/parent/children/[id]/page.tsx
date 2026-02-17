'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Trophy,
  Star,
  Flame,
  Calendar,
  CheckCircle2,
  Clock,
  Award,
  TrendingUp,
  Edit2,
  Key,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { ResetPinModal } from '@/components/ResetPinModal';
import { familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { getInitials, formatPoints, formatDate } from '@/lib/utils';

interface ChildProfile {
  level: number;
  totalXp: number;
  pointsBalance: number;
  totalPointsEarned: number;
  currentStreakDays: number;
  longestStreakDays: number;
  tasksCompletedCount: number;
}

interface Child {
  id: string;
  firstName: string;
  lastName: string;
  username?: string;
  dateOfBirth: string;
  avatarUrl?: string;
  createdAt: string;
  childProfile?: ChildProfile;
}

export default function ChildDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { error: showError } = useToast();
  const [child, setChild] = useState<Child | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showResetPinModal, setShowResetPinModal] = useState(false);

  const childId = params.id as string;

  useEffect(() => {
    const loadChild = async () => {
      try {
        const response = await familyApi.getChild(childId);
        const data = response.data as { child: Child };
        setChild(data.child);
      } catch {
        showError('Failed to load child details');
        router.push('/parent/children');
      } finally {
        setIsLoading(false);
      }
    };

    if (childId) {
      loadChild();
    }
  }, [childId, showError, router]);

  if (isLoading) {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
        </div>
      </ParentLayout>
    );
  }

  if (!child) {
    return (
      <ParentLayout>
        <div className="text-center py-12">
          <p className="text-slate-600">Child not found</p>
          <Link href="/parent/children">
            <Button variant="secondary" className="mt-4">
              Back to Children
            </Button>
          </Link>
        </div>
      </ParentLayout>
    );
  }

  const profile = child.childProfile;
  const age = child.dateOfBirth
    ? Math.floor(
        (new Date().getTime() - new Date(child.dateOfBirth).getTime()) /
          (365.25 * 24 * 60 * 60 * 1000)
      )
    : null;

  return (
    <ParentLayout>
      <div className="space-y-6">
        {/* Back Button */}
        <Link
          href="/parent/children"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Children</span>
        </Link>

        {/* Header Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm"
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            {/* Avatar */}
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-white font-bold text-3xl shadow-lg">
              {child.avatarUrl ? (
                <img
                  src={child.avatarUrl}
                  alt={child.firstName}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                getInitials(child.firstName, child.lastName)
              )}
            </div>

            {/* Info */}
            <div className="flex-1">
              <h1 className="font-display text-2xl font-bold text-slate-900">
                {child.firstName} {child.lastName}
              </h1>
              {child.username && (
                <p className="text-slate-500">@{child.username}</p>
              )}
              <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-600">
                {age !== null && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {age} years old
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  Joined {formatDate(child.createdAt)}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button variant="secondary" size="sm">
                <Edit2 className="w-4 h-4" />
                Edit
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowResetPinModal(true)}>
                <Key className="w-4 h-4" />
                Reset PIN
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Stats Grid */}
        {profile && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              icon={Trophy}
              label="Level"
              value={profile.level}
              color="xp"
            />
            <StatCard
              icon={Star}
              label="Total Points"
              value={formatPoints(profile.totalPointsEarned)}
              color="gold"
            />
            <StatCard
              icon={Flame}
              label="Current Streak"
              value={`${profile.currentStreakDays} days`}
              color="orange"
            />
            <StatCard
              icon={CheckCircle2}
              label="Tasks Completed"
              value={profile.tasksCompletedCount}
              color="green"
            />
          </div>
        )}

        {/* Detailed Stats */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Progress Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl p-6 border border-slate-200"
          >
            <h2 className="font-display text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-xp-500" />
              Progress
            </h2>
            {profile && (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">Level {profile.level}</span>
                    <span className="text-slate-500">
                      {profile.totalXp} XP
                    </span>
                  </div>
                  <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-xp-400 to-xp-600 rounded-full"
                      style={{ width: `${(profile.totalXp % 100)}%` }}
                    />
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-100">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600">Longest Streak</span>
                    <span className="font-bold text-orange-500">
                      {profile.longestStreakDays} days
                    </span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-slate-600">Available Points</span>
                  <span className="font-bold text-gold-600">
                    {formatPoints(profile.pointsBalance)}
                  </span>
                </div>
              </div>
            )}
          </motion.div>

          {/* Achievements Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-xl p-6 border border-slate-200"
          >
            <h2 className="font-display text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Award className="w-5 h-5 text-gold-500" />
              Recent Achievements
            </h2>
            <div className="text-center py-8 text-slate-500">
              <Award className="w-12 h-12 mx-auto mb-2 text-slate-300" />
              <p>No achievements yet</p>
              <p className="text-sm">Complete tasks to earn achievements!</p>
            </div>
          </motion.div>
        </div>

        {/* Reset PIN Modal */}
        {showResetPinModal && (
          <ResetPinModal
            childId={child.id}
            childName={child.firstName}
            onClose={() => setShowResetPinModal(false)}
          />
        )}
      </div>
    </ParentLayout>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: 'xp' | 'gold' | 'orange' | 'green';
}) {
  const colors = {
    xp: 'bg-xp-50 text-xp-600',
    gold: 'bg-gold-50 text-gold-600',
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white rounded-xl p-4 border border-slate-200"
    >
      <div className={`w-10 h-10 rounded-lg ${colors[color]} flex items-center justify-center mb-3`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </motion.div>
  );
}
