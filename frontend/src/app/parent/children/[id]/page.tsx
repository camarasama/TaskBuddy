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
  Loader2,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { ResetPinModal } from '@/components/ResetPinModal';
import { AvatarUpload } from '@/components/AvatarUpload';
import { QuietHoursCard } from '@/components/settings/QuietHoursCard';
import { familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { downloadExport } from '@/lib/downloadExport';
import { reportsApi } from '@/lib/api';
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
  dateOfBirth: Date | string;
  avatarUrl?: string;
  createdAt: Date | string;
  gender?: string | null;
  childProfile?: ChildProfile;
  // U16 — quiet hours / schooltime, returned by GET /families/me/children/:id.
  quietHoursEnabled?: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  schooltimeEnabled?: boolean;
  schooltimeStart?: string;
  schooltimeEnd?: string;
  schooltimeDays?: number[];
}

export default function ChildDetailsPage() {
  const [downloadingCard, setDownloadingCard] = useState(false);
  const params = useParams();
  const router = useRouter();
  const { error: showError } = useToast();
  const [child, setChild] = useState<Child | null>(null);

  /**
   * Download last month's card. Defaults to the month just gone server-side — the card is a look
   * back, so "this month so far" is rarely what anyone wants to share.
   */
  const handleReportCard = async () => {
    setDownloadingCard(true);
    try {
      await downloadExport(reportsApi.reportCardUrl(String(params.id)));
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Could not build the report card');
    } finally {
      setDownloadingCard(false);
    }
  };
  const [isLoading, setIsLoading] = useState(true);
  const [showResetPinModal, setShowResetPinModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const childId = params.id as string;

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

  useEffect(() => {
    if (childId) {
      loadChild();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId]);

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
            <AvatarUpload
              currentUrl={child.avatarUrl}
              initials={getInitials(child.firstName, child.lastName)}
              size="lg"
              onUpload={async (url) => {
                await familyApi.updateChild(child.id, { avatarUrl: url });
                setChild((prev) => prev ? { ...prev, avatarUrl: url } : prev);
              }}
            />

            {/* Info */}
            <div className="flex-1">
              <h1 className="font-display text-2xl font-bold text-slate-900">
                {child.firstName} {child.lastName}
              </h1>
              {child.username && (
                <p className="text-slate-500">@{child.username}</p>
              )}
              {child.gender && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 capitalize">
                  {child.gender}
                </span>
              )}
              {/* Roadmap §5.4: the one artefact designed to leave the product — parents forward it
                  to co-parents and grandparents, and it does the introducing. */}
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleReportCard}
                  disabled={downloadingCard}
                >
                  {downloadingCard ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                  Last month&apos;s report card
                </Button>
              </div>

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
              <Button variant="secondary" size="sm" onClick={() => setIsEditing(true)}>
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

          {/* Quiet hours / schooltime (U16) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
          >
            <QuietHoursCard
              childId={child.id}
              childName={child.firstName}
              initial={{
                quietHoursEnabled: child.quietHoursEnabled,
                quietHoursStart: child.quietHoursStart,
                quietHoursEnd: child.quietHoursEnd,
                schooltimeEnabled: child.schooltimeEnabled,
                schooltimeStart: child.schooltimeStart,
                schooltimeEnd: child.schooltimeEnd,
                schooltimeDays: child.schooltimeDays,
              }}
            />
          </motion.div>
        </div>

        {/* Edit Child Modal */}
        {isEditing && (
          <EditChildModal
            child={child}
            onClose={() => setIsEditing(false)}
            onSuccess={() => {
              setIsEditing(false);
              loadChild();
            }}
          />
        )}

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

function EditChildModal({
  child,
  onClose,
  onSuccess,
}: {
  child: Child;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { error: showError, success: showSuccess } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    firstName: child.firstName,
    lastName: child.lastName,
    username: child.username || '',
    avatarUrl: child.avatarUrl || '',
    gender: child.gender || '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await familyApi.updateChild(child.id, {
        firstName: formData.firstName,
        lastName: formData.lastName,
        username: formData.username || undefined,
        avatarUrl: formData.avatarUrl || undefined,
        gender: formData.gender || undefined,
      });
      showSuccess('Child updated');
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update child';
      showError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-2xl p-6 max-w-md w-full shadow-xl"
      >
        <h2 className="font-display text-xl font-bold text-slate-900 mb-6">Edit Child</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex justify-center">
            <AvatarUpload
              currentUrl={formData.avatarUrl}
              initials={getInitials(formData.firstName || child.firstName, formData.lastName || child.lastName)}
              size="lg"
              onUpload={(url) => setFormData((f) => ({ ...f, avatarUrl: url }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="First Name"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
              required
            />
            <Input
              label="Last Name"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
              required
            />
          </div>

          <Input
            label="Username (optional)"
            placeholder="For child login"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
          />

          <div className="w-full">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Gender (optional)
            </label>
            <select
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              className="w-full px-4 py-3 rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200"
            >
              <option value="">Not specified</option>
              <option value="boy">Boy</option>
              <option value="girl">Girl</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="secondary" fullWidth onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" fullWidth loading={isLoading}>
              Save Changes
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
