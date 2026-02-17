'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy,
  Lock,
  Star,
  Zap,
  Target,
  Flame,
  Award,
  Shield,
  Crown,
} from 'lucide-react';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { achievementsApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, formatPoints, formatDate } from '@/lib/utils';

interface Achievement {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  category?: string;
  tier?: 'bronze' | 'silver' | 'gold' | 'platinum';
  pointsReward: number;
  xpReward: number;
  unlocked: boolean;
  unlockedAt?: string;
  progressValue?: number;
}

interface AchievementStats {
  total: number;
  unlocked: number;
  totalPointsEarned: number;
  totalXpEarned: number;
}

type FilterType = 'all' | 'unlocked' | 'locked';

const tierConfig: Record<string, { gradient: string; border: string; text: string; glow: string }> = {
  bronze: {
    gradient: 'from-amber-600 to-amber-800',
    border: 'border-amber-300',
    text: 'text-amber-700',
    glow: 'shadow-amber-500/30',
  },
  silver: {
    gradient: 'from-slate-300 to-slate-500',
    border: 'border-slate-300',
    text: 'text-slate-600',
    glow: 'shadow-slate-400/30',
  },
  gold: {
    gradient: 'from-gold-400 to-gold-600',
    border: 'border-gold-300',
    text: 'text-gold-700',
    glow: 'shadow-gold-500/30',
  },
  platinum: {
    gradient: 'from-indigo-400 to-purple-600',
    border: 'border-indigo-300',
    text: 'text-indigo-700',
    glow: 'shadow-indigo-500/30',
  },
};

const categoryIcons: Record<string, React.ElementType> = {
  tasks: Target,
  streaks: Flame,
  points: Star,
  social: Shield,
  milestones: Crown,
  special: Award,
};

function getCategoryIcon(category?: string): React.ElementType {
  if (!category) return Trophy;
  return categoryIcons[category.toLowerCase()] || Trophy;
}

export default function ChildAchievementsPage() {
  const { error: showError } = useToast();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [stats, setStats] = useState<AchievementStats>({ total: 0, unlocked: 0, totalPointsEarned: 0, totalXpEarned: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);

  useEffect(() => {
    loadAchievements();
  }, []);

  const loadAchievements = async () => {
    try {
      const response = await achievementsApi.getAll();
      const data = response.data as { achievements: Achievement[]; stats: AchievementStats };
      setAchievements(data.achievements || []);
      setStats(data.stats || { total: 0, unlocked: 0, totalPointsEarned: 0, totalXpEarned: 0 });
    } catch {
      showError('Failed to load achievements');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredAchievements = achievements.filter((a) => {
    if (filter === 'unlocked') return a.unlocked;
    if (filter === 'locked') return !a.unlocked;
    return true;
  });

  // Group by category
  const groupedAchievements = filteredAchievements.reduce((groups, achievement) => {
    const category = achievement.category || 'General';
    if (!groups[category]) groups[category] = [];
    groups[category].push(achievement);
    return groups;
  }, {} as Record<string, Achievement[]>);

  const progressPercent = stats.total > 0 ? Math.round((stats.unlocked / stats.total) * 100) : 0;

  if (isLoading) {
    return (
      <ChildLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-emerald-500 border-t-transparent" />
        </div>
      </ChildLayout>
    );
  }

  return (
    <ChildLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Badges & Achievements
          </h1>
          <p className="text-slate-600">
            Complete challenges to unlock badges!
          </p>
        </div>

        {/* Progress Overview */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-r from-teal-500 to-emerald-700 rounded-2xl p-6 text-white shadow-lg shadow-emerald-500/30"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-emerald-100 text-sm">Badge Collection</p>
              <p className="text-3xl font-bold">
                {stats.unlocked} / {stats.total}
              </p>
            </div>
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
              <Trophy className="w-8 h-8" />
            </div>
          </div>

          {/* Progress Bar */}
          <div className="h-3 bg-white/20 rounded-full overflow-hidden mb-2">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-gold-300 to-gold-500 rounded-full"
            />
          </div>
          <p className="text-sm text-emerald-100">{progressPercent}% Complete</p>

          {/* Stats Row */}
          {(stats.totalPointsEarned > 0 || stats.totalXpEarned > 0) && (
            <div className="flex gap-4 mt-4 pt-4 border-t border-white/20">
              {stats.totalPointsEarned > 0 && (
                <div className="flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-gold-300" />
                  <span className="text-sm font-medium">{formatPoints(stats.totalPointsEarned)} pts earned</span>
                </div>
              )}
              {stats.totalXpEarned > 0 && (
                <div className="flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-gold-300" />
                  <span className="text-sm font-medium">{formatPoints(stats.totalXpEarned)} XP earned</span>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* Filter Tabs */}
        <div className="flex gap-2">
          {([
            { key: 'all', label: 'All' },
            { key: 'unlocked', label: 'Unlocked' },
            { key: 'locked', label: 'Locked' },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={cn(
                'px-4 py-2 rounded-full text-sm font-medium transition-all',
                filter === tab.key
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-teal-300'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Achievements Grid */}
        {filteredAchievements.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
            <Trophy className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <h3 className="font-bold text-slate-900 mb-2">
              {filter === 'unlocked' ? 'No badges unlocked yet' : filter === 'locked' ? 'All badges unlocked!' : 'No badges available'}
            </h3>
            <p className="text-slate-600">
              {filter === 'unlocked' ? 'Complete tasks to earn your first badge!' : filter === 'locked' ? 'Amazing work!' : 'Badges will appear here soon.'}
            </p>
          </div>
        ) : (
          Object.entries(groupedAchievements).map(([category, categoryAchievements]) => (
            <motion.section
              key={category}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h2 className="font-display font-bold text-lg text-slate-900 mb-3 flex items-center gap-2 capitalize">
                {(() => {
                  const Icon = getCategoryIcon(category);
                  return <Icon className="w-5 h-5 text-teal-500" />;
                })()}
                {category}
              </h2>
              <div className="grid grid-cols-3 gap-3">
                {categoryAchievements.map((achievement, index) => (
                  <motion.div
                    key={achievement.id}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <AchievementBadge
                      achievement={achievement}
                      onClick={() => setSelectedAchievement(achievement)}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.section>
          ))
        )}
      </div>

      {/* Achievement Detail Modal */}
      <AnimatePresence>
        {selectedAchievement && (
          <AchievementModal
            achievement={selectedAchievement}
            onClose={() => setSelectedAchievement(null)}
          />
        )}
      </AnimatePresence>
    </ChildLayout>
  );
}

// Achievement Badge Component
function AchievementBadge({
  achievement,
  onClick,
}: {
  achievement: Achievement;
  onClick: () => void;
}) {
  const tier = achievement.tier || 'bronze';
  const config = tierConfig[tier] || tierConfig.bronze;
  const Icon = getCategoryIcon(achievement.category);

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={cn(
        'w-full flex flex-col items-center p-3 rounded-xl border-2 transition-all',
        achievement.unlocked
          ? `bg-white ${config.border} shadow-md ${config.glow}`
          : 'bg-slate-50 border-slate-200 opacity-60'
      )}
    >
      {/* Badge Icon */}
      <div
        className={cn(
          'w-14 h-14 rounded-full flex items-center justify-center mb-2 relative',
          achievement.unlocked
            ? `bg-gradient-to-br ${config.gradient} shadow-lg`
            : 'bg-slate-200'
        )}
      >
        {achievement.unlocked ? (
          <Icon className="w-7 h-7 text-white" />
        ) : (
          <Lock className="w-6 h-6 text-slate-400" />
        )}
      </div>

      {/* Name */}
      <p className={cn(
        'text-xs font-bold text-center line-clamp-2',
        achievement.unlocked ? 'text-slate-900' : 'text-slate-400'
      )}>
        {achievement.name}
      </p>

      {/* Tier Label */}
      {achievement.unlocked && (
        <span className={cn('text-[10px] font-semibold mt-1 capitalize', config.text)}>
          {tier}
        </span>
      )}
    </motion.button>
  );
}

// Achievement Detail Modal
function AchievementModal({
  achievement,
  onClose,
}: {
  achievement: Achievement;
  onClose: () => void;
}) {
  const tier = achievement.tier || 'bronze';
  const config = tierConfig[tier] || tierConfig.bronze;
  const Icon = getCategoryIcon(achievement.category);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Badge */}
        <div className="flex flex-col items-center mb-6">
          <motion.div
            initial={{ rotate: -10 }}
            animate={{ rotate: 0 }}
            className={cn(
              'w-24 h-24 rounded-full flex items-center justify-center mb-4',
              achievement.unlocked
                ? `bg-gradient-to-br ${config.gradient} shadow-xl ${config.glow}`
                : 'bg-slate-200'
            )}
          >
            {achievement.unlocked ? (
              <Icon className="w-12 h-12 text-white" />
            ) : (
              <Lock className="w-10 h-10 text-slate-400" />
            )}
          </motion.div>

          <h3 className="font-display text-xl font-bold text-slate-900 text-center">
            {achievement.name}
          </h3>

          {achievement.tier && (
            <span className={cn(
              'mt-1 px-3 py-0.5 rounded-full text-xs font-bold uppercase',
              achievement.unlocked
                ? `bg-gradient-to-r ${config.gradient} text-white`
                : 'bg-slate-100 text-slate-500'
            )}>
              {achievement.tier}
            </span>
          )}
        </div>

        {/* Description */}
        {achievement.description && (
          <p className="text-slate-600 text-center mb-4">
            {achievement.description}
          </p>
        )}

        {/* Rewards */}
        {(achievement.pointsReward > 0 || achievement.xpReward > 0) && (
          <div className="flex justify-center gap-4 mb-4">
            {achievement.pointsReward > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gold-50 rounded-full">
                <Star className="w-4 h-4 text-gold-500" />
                <span className="text-sm font-bold text-gold-700">
                  +{achievement.pointsReward} pts
                </span>
              </div>
            )}
            {achievement.xpReward > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 rounded-full">
                <Zap className="w-4 h-4 text-teal-500" />
                <span className="text-sm font-bold text-teal-700">
                  +{achievement.xpReward} XP
                </span>
              </div>
            )}
          </div>
        )}

        {/* Unlock Status */}
        <div className={cn(
          'text-center py-3 rounded-xl',
          achievement.unlocked ? 'bg-success-50' : 'bg-slate-50'
        )}>
          {achievement.unlocked ? (
            <div>
              <p className="font-bold text-success-700 flex items-center justify-center gap-1.5">
                <Trophy className="w-4 h-4" />
                Unlocked!
              </p>
              {achievement.unlockedAt && (
                <p className="text-xs text-success-600 mt-1">
                  {formatDate(achievement.unlockedAt)}
                </p>
              )}
            </div>
          ) : (
            <p className="font-medium text-slate-500 flex items-center justify-center gap-1.5">
              <Lock className="w-4 h-4" />
              Keep going to unlock this badge!
            </p>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-full mt-4 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-medium hover:bg-slate-200 transition-colors"
        >
          Close
        </button>
      </motion.div>
    </motion.div>
  );
}
