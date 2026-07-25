'use client';

/**
 * components/SetupChecklistCard — the dashboard entry point to the setup wizard.
 *
 * Growth roadmap §3.2 says the checklist "lives on the parent dashboard until done". This is that:
 * a compact progress strip that disappears the moment setup is complete or the parent skips it.
 *
 * Renders NOTHING while loading, when complete, or when dismissed — a dashboard should not flash a
 * banner at a parent who already finished, and a failed fetch must not push the real content down.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Sparkles, ArrowRight } from 'lucide-react';
import { onboardingApi } from '@/lib/api';
import type { OnboardingState } from '@/lib/api';

const TOTAL_STEPS = 4;

export function SetupChecklistCard() {
  const [state, setState] = useState<OnboardingState | null>(null);

  useEffect(() => {
    let cancelled = false;
    onboardingApi
      .get()
      .then((res) => {
        if (!cancelled) setState((res.data as { state: OnboardingState }).state);
      })
      // Silent: a setup nudge is not worth an error toast, and hiding it is the safe failure.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state || state.dismissed) return null;

  const completed = state.completedSteps.length;
  if (completed >= TOTAL_STEPS) return null;

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
      <Link
        href="/parent/welcome"
        className="block bg-gradient-to-r from-primary-50 to-xp-50 border border-primary-200 rounded-2xl p-4 hover:border-primary-300 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-primary-600" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-900">
              {completed === 0 ? 'Finish setting up TaskBuddy' : 'Nearly there'}
            </p>
            <p className="text-sm text-slate-600">
              {completed} of {TOTAL_STEPS} steps done — pick up where you left off.
            </p>
            <div className="h-1.5 bg-white/70 rounded-full overflow-hidden mt-2 max-w-xs">
              <div
                className="h-full bg-primary-500 rounded-full transition-all"
                style={{ width: `${(completed / TOTAL_STEPS) * 100}%` }}
              />
            </div>
          </div>

          <ArrowRight className="w-5 h-5 text-primary-500 shrink-0" />
        </div>
      </Link>
    </motion.div>
  );
}
