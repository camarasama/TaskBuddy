'use client';

/**
 * /child/recap — "My Week" (growth roadmap §6).
 *
 * The child-facing half of the parent's weekly digest, as a small stack of swipeable cards.
 *
 * Two things it will not do. It never compares this child to a sibling — the leaderboard is
 * opt-out-able by design, and a recap has no opt out to offer. And it never celebrates a week that
 * did not happen: a quiet week gets an honest card and a way forward, because a child reads
 * "you crushed it!" over zero tasks as the app not paying attention.
 *
 * The page is reachable every day. Only the *prompt* on the dashboard is Friday-onward — hiding a
 * child's own summary of their own week for five days out of seven would be a strange thing to do.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ChevronLeft, ChevronRight, Star, Flame, Trophy, Gamepad2, Users, Calendar, Loader2,
} from 'lucide-react';
import type { WeekRecapResponse } from '@taskbuddy/shared';
import { dashboardApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface Card {
  key: string;
  icon: React.ReactNode;
  headline: string;
  detail: string;
  tint: string;
}

/** Cards are built from what actually happened — a week with no games has no games card. */
function buildCards(recap: WeekRecapResponse): Card[] {
  const cards: Card[] = [];

  cards.push({
    key: 'tasks',
    icon: <Star className="w-10 h-10" />,
    headline:
      recap.tasksApproved === 0
        ? 'A quiet week'
        : `${recap.tasksApproved} task${recap.tasksApproved === 1 ? '' : 's'} done`,
    detail:
      recap.tasksApproved === 0
        ? 'Nothing was finished last week — and that is completely fine. This week is a fresh start.'
        : `You earned ${recap.pointsEarned} points.`,
    tint: 'from-primary-500 to-indigo-600',
  });

  if (recap.bestDay) {
    const day = new Date(`${recap.bestDay.date}T00:00:00Z`).toLocaleDateString(undefined, {
      weekday: 'long',
      timeZone: 'UTC',
    });
    cards.push({
      key: 'bestday',
      icon: <Calendar className="w-10 h-10" />,
      headline: `${day} was your best day`,
      detail: `${recap.bestDay.tasksApproved} task${recap.bestDay.tasksApproved === 1 ? '' : 's'} approved.`,
      tint: 'from-sky-500 to-cyan-600',
    });
  }

  if (recap.currentStreak > 0 || recap.longestStreak > 0) {
    cards.push({
      key: 'streak',
      icon: <Flame className="w-10 h-10" />,
      headline: `${recap.currentStreak}-day streak`,
      detail:
        recap.currentStreak >= recap.longestStreak && recap.currentStreak > 0
          ? 'That is your best run yet.'
          : `Your record is ${recap.longestStreak} days.`,
      tint: 'from-orange-500 to-red-500',
    });
  }

  if (recap.achievementsUnlocked.length > 0) {
    cards.push({
      key: 'badges',
      icon: <Trophy className="w-10 h-10" />,
      headline: `${recap.achievementsUnlocked.length} new badge${recap.achievementsUnlocked.length === 1 ? '' : 's'}`,
      detail: recap.achievementsUnlocked.map((a) => a.name).join(' · '),
      tint: 'from-gold-500 to-amber-600',
    });
  }

  if (recap.teamUpsCompleted > 0) {
    cards.push({
      key: 'team',
      icon: <Users className="w-10 h-10" />,
      headline: `${recap.teamUpsCompleted} team-up${recap.teamUpsCompleted === 1 ? '' : 's'} finished`,
      detail: 'You and your teammate both got the bonus.',
      tint: 'from-violet-500 to-purple-600',
    });
  }

  if (recap.gamesPlayed > 0) {
    cards.push({
      key: 'games',
      icon: <Gamepad2 className="w-10 h-10" />,
      headline: `${recap.gamesPlayed} game${recap.gamesPlayed === 1 ? '' : 's'} played`,
      detail: 'Nice brain workout.',
      tint: 'from-emerald-500 to-teal-600',
    });
  }

  if (recap.pointsSpent > 0) {
    cards.push({
      key: 'spent',
      icon: <Star className="w-10 h-10" />,
      headline: `${recap.pointsSpent} points spent`,
      detail: 'Hope it was worth it!',
      tint: 'from-pink-500 to-rose-600',
    });
  }

  return cards;
}

export default function WeekRecapPage() {
  const { error: showError } = useToast();
  const [recap, setRecap] = useState<WeekRecapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await dashboardApi.getWeekRecap();
      setRecap(res.data as WeekRecapResponse);
    } catch {
      showError('Could not load your week');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }
  if (!recap) return null;

  const cards = buildCards(recap);
  const card = cards[Math.min(index, cards.length - 1)];
  const weekOf = new Date(recap.weekStart).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  return (
    <div className="min-h-screen bg-slate-900 text-white px-4 py-6 flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <Link href="/child/dashboard" className="p-2 -ml-2 rounded-lg hover:bg-white/10">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="text-center">
          <p className="font-display font-bold">My Week</p>
          <p className="text-xs text-white/50">Week of {weekOf}</p>
        </div>
        <div className="w-9" />
      </div>

      <div className="flex-1 flex items-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={card.key}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.2 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -60) setIndex((i) => Math.min(i + 1, cards.length - 1));
              if (info.offset.x > 60) setIndex((i) => Math.max(i - 1, 0));
            }}
            className={`w-full rounded-3xl bg-gradient-to-br ${card.tint} p-8 shadow-2xl cursor-grab active:cursor-grabbing`}
          >
            <div className="opacity-90 mb-4">{card.icon}</div>
            <h2 className="font-display text-3xl font-bold leading-tight">{card.headline}</h2>
            <p className="text-white/85 mt-2">{card.detail}</p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-center gap-1.5 my-5">
        {cards.map((c, i) => (
          <button
            key={c.key}
            onClick={() => setIndex(i)}
            aria-label={`Card ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/30'
            }`}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          disabled={index === 0}
          className="p-3 rounded-full bg-white/10 disabled:opacity-30"
          aria-label="Previous"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {index === cards.length - 1 ? (
          <Link href="/child/tasks">
            <Button className="bg-white text-slate-900 hover:bg-white/90">
              {recap.quietWeek ? 'Start this week' : 'Keep it going'}
            </Button>
          </Link>
        ) : (
          <p className="text-sm text-white/50">Swipe to see more</p>
        )}

        <button
          onClick={() => setIndex((i) => Math.min(i + 1, cards.length - 1))}
          disabled={index === cards.length - 1}
          className="p-3 rounded-full bg-white/10 disabled:opacity-30"
          aria-label="Next"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
