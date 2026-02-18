'use client';

/**
 * LevelUpCelebration.tsx — M7: Level-up celebration modal (CR-06)
 *
 * Place at: frontend/src/components/LevelUpCelebration.tsx
 *
 * Shown when the approval endpoint returns levelUp.leveledUp === true.
 * Displays the new level, the bonus Points awarded, and a dismiss button.
 *
 * The parent component (child dashboard or task approval handler) is
 * responsible for tracking whether to show this and calling onClose().
 *
 * Props:
 *  isOpen          — whether the modal is visible
 *  onClose         — callback to dismiss the modal
 *  newLevel        — the level the child just reached
 *  bonusPoints     — bonus Points awarded for levelling up (level × 5)
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Star, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface LevelUpCelebrationProps {
  isOpen: boolean;
  onClose: () => void;
  newLevel: number;
  bonusPoints: number;
}

export function LevelUpCelebration({
  isOpen,
  onClose,
  newLevel,
  bonusPoints,
}: LevelUpCelebrationProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="fixed inset-0 flex items-center justify-center z-50 p-4 pointer-events-none"
          >
            <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center pointer-events-auto relative overflow-hidden">

              {/* Dismiss button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Decorative background burst */}
              <div className="absolute inset-0 bg-gradient-to-br from-xp-50 via-white to-gold-50 opacity-60 pointer-events-none" />

              <div className="relative">
                {/* Animated star icon */}
                <motion.div
                  animate={{ rotate: [0, -10, 10, -10, 10, 0], scale: [1, 1.2, 1] }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className="flex items-center justify-center mb-4"
                >
                  <div className="w-20 h-20 bg-gradient-to-br from-xp-400 to-xp-600 rounded-full flex items-center justify-center shadow-lg shadow-xp-200">
                    <Star className="w-10 h-10 text-white fill-white" />
                  </div>
                </motion.div>

                {/* Heading */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <p className="text-sm font-medium text-xp-600 uppercase tracking-widest mb-1">
                    Level Up!
                  </p>
                  <h2 className="font-display text-4xl font-bold text-slate-900 mb-2">
                    Level {newLevel}
                  </h2>
                  <p className="text-slate-600 mb-6">
                    Amazing work! You&apos;ve reached a new level!
                  </p>
                </motion.div>

                {/* Bonus Points badge */}
                {bonusPoints > 0 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.5, type: 'spring' }}
                    className="bg-gold-50 border border-gold-200 rounded-xl px-6 py-4 mb-6 inline-block"
                  >
                    <p className="text-xs text-gold-600 font-medium uppercase tracking-wide mb-1">
                      Level-Up Bonus
                    </p>
                    <p className="text-2xl font-bold text-gold-600">
                      +{bonusPoints} Points
                    </p>
                  </motion.div>
                )}

                {/* Dismiss button */}
                <Button
                  onClick={onClose}
                  fullWidth
                  className="bg-gradient-to-r from-xp-500 to-xp-600 hover:from-xp-600 hover:to-xp-700 text-white border-0"
                >
                  Keep Going! 🚀
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
