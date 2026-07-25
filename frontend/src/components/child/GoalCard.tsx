'use client';

/**
 * components/child/GoalCard — "I'm saving for…" (growth roadmap §4.2).
 *
 * The goal-gradient effect: completion rates rise as a bar fills. One visible target the child chose
 * themselves beats a longer list of things they might want, which is why only one can be pinned.
 *
 * Progress arrives already derived from the live balance — there is no stored counter to drift when
 * points are spent, refunded, or reversed by the revoke flow.
 */

import { motion } from 'framer-motion';
import Link from 'next/link';
import { Target, Sparkles } from 'lucide-react';
import type { ChildGoal } from '@/lib/api';

export function GoalCard({ goal }: { goal: ChildGoal | null | undefined }) {
  if (!goal) {
    return (
      <Link
        href="/child/rewards"
        className="block bg-white rounded-2xl border-2 border-dashed border-slate-200 p-5 text-center hover:border-gold-300 transition-colors"
      >
        <Target className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="font-bold text-slate-900">Pick something to save for</p>
        <p className="text-sm text-slate-500 mt-0.5">
          Choose a reward and watch your progress fill up.
        </p>
      </Link>
    );
  }

  const affordable = goal.pointsNeeded === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-gradient-to-br from-gold-50 to-white rounded-2xl border border-gold-200 p-5"
    >
      <div className="flex items-center gap-2 mb-1">
        <Target className="w-4 h-4 text-gold-600" />
        <p className="text-sm font-medium text-gold-700">I&apos;m saving for</p>
      </div>

      <p className="font-display text-lg font-bold text-slate-900">{goal.name}</p>

      <div className="mt-3 h-3 bg-white rounded-full overflow-hidden border border-gold-100">
        <motion.div
          className="h-full bg-gradient-to-r from-gold-400 to-gold-600 rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${goal.percent}%` }}
          transition={{ duration: 0.6 }}
        />
      </div>

      <div className="flex items-center justify-between mt-2 text-sm">
        <span className="text-slate-600 font-medium">
          {goal.pointsBalance} / {goal.pointsCost} pts
        </span>
        {affordable ? (
          <span className="text-success-700 font-bold flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            You can get it!
          </span>
        ) : (
          <span className="text-slate-500">
            about {goal.tasksToGo} {goal.tasksToGo === 1 ? 'task' : 'tasks'} to go
          </span>
        )}
      </div>

      {affordable && (
        <Link
          href="/child/rewards"
          className="mt-3 block text-center rounded-xl bg-gold-500 text-white font-bold py-2.5 hover:bg-gold-600 transition-colors"
        >
          Go and claim it
        </Link>
      )}
    </motion.div>
  );
}
