'use client';

/**
 * components/rewards/RewardPresetPicker — starter reward ideas (growth roadmap §3.1).
 *
 * Deliberately mirrors `components/tasks/TemplatePicker`: same modal shape, same "browse → pick →
 * the form pre-fills → edit → submit" flow, same deep-link entry from the empty state.
 *
 * It began life as an inline panel behind a "Need ideas?" toggle, which meant the rewards empty
 * state dropped a parent on a blank form and left them to find the ideas themselves — the exact
 * cold-start problem §3.1 exists to remove, and inconsistent with the tasks flow sitting next to it.
 *
 * Nothing is created here. Picking fills the form; the parent edits and submits as normal.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Loader2, X, Star, TrendingUp, Check } from 'lucide-react';
import { templatesApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/utils';
import type { RewardPreset, RankedRewardPreset } from '@taskbuddy/shared';

const TIER_STYLES: Record<RewardPreset['tier'], string> = {
  small: 'bg-slate-100 text-slate-600',
  medium: 'bg-primary-100 text-primary-700',
  large: 'bg-gold-100 text-gold-700',
};

export function RewardPresetPicker({
  onUsePreset,
  onClose,
}: {
  onUsePreset: (preset: RewardPreset) => void;
  onClose: () => void;
}) {
  const { error: showError } = useToast();
  const [presets, setPresets] = useState<RankedRewardPreset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    templatesApi
      .rewardPresets()
      .then((res) => {
        if (!cancelled) setPresets((res.data as { presets: RankedRewardPreset[] }).presets);
      })
      .catch(() => {
        if (!cancelled) showError('Could not load reward ideas');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showError]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start justify-center overflow-y-auto p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl my-8 shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-gold-500" />
              Reward ideas
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">
              Pick one to fill the form — you can change anything before saving. Ordered by what
              families redeem most, with your own history counting the most.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="p-12 flex justify-center">
            <Loader2 className="w-8 h-8 text-gold-500 animate-spin" />
          </div>
        ) : presets.length === 0 ? (
          <p className="p-12 text-center text-sm text-slate-500">No ideas available right now.</p>
        ) : (
          <div className="p-6 grid sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto">
            {presets.map((preset, i) => (
              <motion.button
                key={preset.name}
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.02, 0.2) }}
                onClick={() => {
                  onUsePreset(preset);
                  onClose();
                }}
                className="text-left rounded-xl border border-slate-200 p-4 hover:border-gold-400 hover:bg-gold-50/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-medium text-slate-900">{preset.name}</p>
                  <span
                    className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium shrink-0',
                      TIER_STYLES[preset.tier],
                    )}
                  >
                    {preset.tier}
                  </span>
                </div>
                <p className="text-sm text-slate-500">{preset.description}</p>
                <div className="flex items-center justify-between gap-2 mt-2">
                  <p className="text-sm text-gold-600 font-medium flex items-center gap-1">
                    <Star className="w-3.5 h-3.5" />
                    {preset.pointsCost} pts
                  </p>

                  {/* U19 — say WHY it is ranked where it is. An unexplained reordering just looks
                      like the list moved on its own. */}
                  {preset.familyRedemptions > 0 ? (
                    <span className="text-xs text-primary-600 font-medium">
                      Redeemed {preset.familyRedemptions}× here
                    </span>
                  ) : preset.popularity > 0 ? (
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      Popular
                    </span>
                  ) : null}
                </div>

                {preset.alreadyAdded && (
                  <p className="text-xs text-slate-400 mt-1.5 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    You already have this one
                  </p>
                )}
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
