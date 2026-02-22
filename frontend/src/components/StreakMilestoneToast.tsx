'use client';

/**
 * components/StreakMilestoneToast.tsx — M10 Phase 6
 *
 * Celebration toast for streak milestones (7, 14, 21, 30, 60, 100 days…).
 * Fired from child/dashboard/page.tsx when the dashboard data or a socket
 * event reveals the child has hit a milestone streak day.
 *
 * Milestone thresholds:  7 · 14 · 21 · 30 · 60 · 100 · 150 · 200 · 365
 *
 * Auto-dismisses after 6 seconds. The longer duration vs AchievementToast
 * reflects the bigger accomplishment — staying consistent for a week+ is hard.
 *
 * Usage:
 *   <StreakMilestoneToast
 *     show={streakToast.show}
 *     streakDays={streakToast.streakDays}
 *     onDismiss={() => setStreakToast(s => ({ ...s, show: false }))}
 *   />
 */

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface StreakMilestoneToastProps {
  show: boolean;
  streakDays: number;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Default 6000. */
  autoDismissMs?: number;
}

/** Milestone thresholds that trigger the toast */
export const STREAK_MILESTONES = [7, 14, 21, 30, 60, 100, 150, 200, 365] as const;

/** Returns true if streakDays is exactly a milestone */
export function isStreakMilestone(days: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(days);
}

function getMilestoneEmoji(days: number): string {
  if (days >= 365) return '👑';
  if (days >= 100) return '🌟';
  if (days >= 60)  return '💎';
  if (days >= 30)  return '🔥';
  if (days >= 14)  return '⚡';
  return '🎯';
}

function getMilestoneLabel(days: number): string {
  if (days >= 365) return 'One full year — legendary!';
  if (days >= 100) return 'Triple digits — incredible!';
  if (days >= 60)  return 'Two months strong!';
  if (days >= 30)  return 'One month — unstoppable!';
  if (days >= 21)  return 'Three weeks of consistency!';
  if (days >= 14)  return 'Two week warrior!';
  return 'One week streak — great start!';
}

export function StreakMilestoneToast({
  show,
  streakDays,
  onDismiss,
  autoDismissMs = 6000,
}: StreakMilestoneToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!show) return;
    timerRef.current = setTimeout(onDismiss, autoDismissMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [show, autoDismissMs, onDismiss]);

  const emoji = getMilestoneEmoji(streakDays);
  const label = getMilestoneLabel(streakDays);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="streak-milestone-toast"
          initial={{ opacity: 0, y: -80, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -60, scale: 0.9 }}
          transition={{ type: 'spring', damping: 18, stiffness: 280 }}
          // Offset slightly lower than AchievementToast so they don't stack on each other
          className="fixed top-20 left-1/2 -translate-x-1/2 z-60 max-w-sm w-full mx-4 pointer-events-auto"
          role="status"
          aria-live="polite"
        >
          <div className="relative flex items-center gap-4 px-5 py-4 rounded-2xl bg-gradient-to-r from-orange-400 via-red-500 to-rose-600 text-white shadow-2xl shadow-red-500/40">
            {/* Flame icon with pulse */}
            <div className="relative shrink-0">
              <span className="relative z-10 text-3xl">{emoji}</span>
              <motion.span
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                className="absolute inset-0 rounded-full bg-white/20"
              />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest opacity-90 mb-0.5">
                🔥 {streakDays}-Day Streak!
              </p>
              <p className="font-bold text-base leading-snug">
                {label}
              </p>
            </div>

            {/* Dismiss */}
            <button
              onClick={onDismiss}
              aria-label="Dismiss streak notification"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors text-sm font-bold"
            >
              ✕
            </button>

            {/* Auto-dismiss progress bar */}
            <motion.div
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: autoDismissMs / 1000, ease: 'linear' }}
              style={{ originX: 0 }}
              className="absolute bottom-0 left-0 right-0 h-1 rounded-b-2xl bg-white/40"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
