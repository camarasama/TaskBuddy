'use client';

/**
 * components/AchievementToast.tsx — M10 Phase 6
 *
 * Slide-in celebration toast that fires when the socket emits
 * 'achievement:unlocked' for the current child.
 *
 * Auto-dismisses after 5 seconds. Manual dismiss via ✕ button.
 * Renders at the top-centre of the viewport, above all other content (z-60).
 *
 * Usage:
 *   <AchievementToast
 *     show={achievementToast.show}
 *     achievementName={achievementToast.achievementName}
 *     onDismiss={() => setAchievementToast(s => ({ ...s, show: false }))}
 *   />
 */

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface AchievementToastProps {
  show: boolean;
  achievementName: string;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Default 5000. */
  autoDismissMs?: number;
}

export function AchievementToast({
  show,
  achievementName,
  onDismiss,
  autoDismissMs = 5000,
}: AchievementToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss
  useEffect(() => {
    if (!show) return;
    timerRef.current = setTimeout(onDismiss, autoDismissMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [show, autoDismissMs, onDismiss]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="achievement-toast"
          initial={{ opacity: 0, y: -80, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -60, scale: 0.9 }}
          transition={{ type: 'spring', damping: 20, stiffness: 300 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-60 max-w-sm w-full mx-4 pointer-events-auto"
          role="status"
          aria-live="polite"
        >
          <div className="relative flex items-center gap-4 px-5 py-4 rounded-2xl bg-gradient-to-r from-gold-400 to-gold-600 text-white shadow-2xl shadow-gold-500/40">
            {/* Icon pulse ring */}
            <div className="relative shrink-0">
              <span className="relative z-10 text-3xl">🏆</span>
              <span className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
            </div>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest opacity-90 mb-0.5">
                Achievement Unlocked!
              </p>
              <p className="font-bold text-base leading-snug truncate">
                {achievementName}
              </p>
            </div>

            {/* Dismiss button */}
            <button
              onClick={onDismiss}
              aria-label="Dismiss achievement notification"
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white text-sm font-bold"
            >
              ✕
            </button>

            {/* Progress bar auto-dismiss indicator */}
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
