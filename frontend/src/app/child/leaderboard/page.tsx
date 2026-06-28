'use client';
import { useDataRefresh } from '@/hooks/useDataRefresh';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { dashboardApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

type Period = 'weekly' | 'monthly' | 'all-time';

interface LeaderboardEntry {
  childId: string;
  childName: string;
  avatarUrl: string | null;
  gender?: string | null;
  weeklyPoints: number;
  weeklyTasks: number;
  currentStreak: number;
  score: number;
  rank: number;
}

function childEmoji(entry: LeaderboardEntry): string {
  if (entry.gender === 'male')   return '👦';
  if (entry.gender === 'female') return '👧';
  return '🧒';
}

interface LeaderboardData {
  enabled: boolean;
  period: string;
  entries: LeaderboardEntry[];
  updatedAt: string;
}

const MEDAL = ['🥇', '🥈', '🥉'];

// Podium visual order: [silver idx=0, gold idx=1, bronze idx=2]
// Maps to entry indices (sorted by rank): rank2=entries[1], rank1=entries[0], rank3=entries[2]
const PODIUM_ENTRY_IDX = [1, 0, 2];
const PODIUM_BG = [
  'from-slate-200 to-slate-100 border-slate-300',    // silver
  'from-amber-300 to-amber-100 border-amber-400',    // gold
  'from-orange-200 to-orange-100 border-orange-300', // bronze
];
const PODIUM_MEDAL_IDX = [1, 0, 2]; // which MEDAL[] to use per podium slot

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>('weekly');
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await dashboardApi.getLeaderboard(period);
      setData((res as any).data as LeaderboardData);
    } catch {
      // API error - leave previous data in place
    } finally {
      setLoading(false);
    }
  }, [period]);

  // Refetch when period changes, and every 30 s
  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);
  useDataRefresh(load);

  const myId = (user as any)?.id;
  const entries = data?.entries ?? [];

  return (
    <ChildLayout>
      <div className="space-y-6">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <h1 className="font-display text-2xl font-bold text-slate-900 mb-1">
            Leaderboard 🏆
          </h1>
          <p className="text-sm text-slate-500">See how you rank in the family</p>
        </motion.div>

        {/* Period selector */}
        <div className="flex gap-2 justify-center">
          {(['weekly', 'monthly', 'all-time'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                period === p
                  ? 'bg-xp-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              {p === 'weekly' ? 'This Week' : p === 'monthly' ? 'This Month' : 'All Time'}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-xp-500 border-t-transparent" />
          </div>
        )}

        {/* Locked state */}
        {!loading && data && !data.enabled && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl border border-slate-200 p-10 text-center shadow-sm"
          >
            <Lock className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <p className="font-bold text-slate-700 mb-1">Leaderboard is turned off</p>
            <p className="text-sm text-slate-400">Ask a parent to enable it in family settings.</p>
          </motion.div>
        )}

        {/* Empty state */}
        {!loading && data?.enabled && entries.length === 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center shadow-sm text-slate-400">
            No data for this period yet.
          </div>
        )}

        {/* Leaderboard content */}
        {!loading && data?.enabled && entries.length > 0 && (
          <>
            {/* Podium - top 3 */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="flex items-end justify-center gap-3 pt-4"
            >
              {PODIUM_ENTRY_IDX.map((entryIdx, slotIdx) => {
                const entry = entries[entryIdx];
                if (!entry) return null;
                const isMe = entry.childId === myId;
                const isGold = slotIdx === 1;
                return (
                  <div
                    key={entry.childId}
                    className={cn(
                      'flex-1 max-w-[130px] rounded-2xl border bg-gradient-to-b p-4 text-center transition-all',
                      PODIUM_BG[slotIdx],
                      isGold ? 'scale-105 shadow-lg' : '',
                      isMe ? 'ring-2 ring-xp-500 ring-offset-1' : ''
                    )}
                  >
                    <div className="text-3xl mb-1">{childEmoji(entry)}</div>
                    <div className="text-xl">{MEDAL[PODIUM_MEDAL_IDX[slotIdx]]}</div>
                    <div className={cn(
                      'font-bold text-sm mt-1 truncate',
                      isMe ? 'text-xp-700' : 'text-slate-800'
                    )}>
                      {entry.childName.split(' ')[0]}
                      {isMe && <span className="block text-xs font-normal text-xp-500">You</span>}
                    </div>
                    <div className="text-xl font-black text-indigo-600 mt-1">{entry.score}</div>
                    <div className="text-xs text-slate-500">pts</div>
                    <div className="text-xs text-slate-400 mt-1">🔥 {entry.currentStreak}d</div>
                  </div>
                );
              })}
            </motion.div>

            {/* Full ranked list */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"
            >
              <div className="divide-y divide-slate-50">
                {entries.map((entry) => {
                  const isMe = entry.childId === myId;
                  return (
                    <div
                      key={entry.childId}
                      className={cn(
                        'flex items-center gap-4 px-5 py-4 transition-colors',
                        isMe
                          ? 'bg-xp-50 border-l-4 border-xp-500'
                          : entry.rank <= 3
                          ? 'bg-indigo-50/30 hover:bg-indigo-50/50'
                          : 'hover:bg-slate-50/50'
                      )}
                    >
                      {/* Rank */}
                      <div className="w-8 text-center font-bold text-slate-600 shrink-0">
                        {MEDAL[entry.rank - 1] ?? `#${entry.rank}`}
                      </div>

                      {/* Avatar */}
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center text-lg shrink-0">
                        {childEmoji(entry)}
                      </div>

                      {/* Name + stats */}
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          'font-semibold truncate',
                          isMe ? 'text-xp-800' : 'text-slate-800'
                        )}>
                          {entry.childName}
                          {isMe && (
                            <span className="ml-1.5 text-xs font-normal text-xp-500 bg-xp-100 px-1.5 py-0.5 rounded-full">
                              You
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">
                          {entry.weeklyTasks} tasks · 🔥 {entry.currentStreak}d streak
                        </p>
                      </div>

                      {/* Score */}
                      <div className="font-black text-indigo-600 text-lg shrink-0 text-right">
                        {entry.score}
                        <span className="block text-xs text-slate-400 font-normal leading-none">pts</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </div>
    </ChildLayout>
  );
}
