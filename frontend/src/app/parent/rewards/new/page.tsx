'use client';

/**
 * New Reward Page - updated M6 (CR-11)
 *
 * Added fields:
 *  - maxRedemptionsPerChild: how many times ONE child can claim this reward
 *  - maxRedemptionsTotal: household cap across ALL children combined
 *  - expiresAt: optional date/time after which the reward is locked
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Users, User, Calendar, Sparkles } from 'lucide-react';
import { templatesApi } from '@/lib/api';
import type { RewardPreset } from '@taskbuddy/shared';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { rewardsApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

const TIER_OPTIONS = [
  { value: 'small', label: '🥉 Small', description: 'Quick, everyday rewards' },
  { value: 'medium', label: '🥈 Medium', description: 'Bigger treats' },
  { value: 'large', label: '🥇 Large', description: 'Special occasions' },
] as const;

export default function NewRewardPage() {
  const router = useRouter();
  const { error: showError, success: showSuccess } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [presets, setPresets] = useState<RewardPreset[]>([]);

  // Loaded lazily — the presets are only needed once the parent opens the ideas panel.
  useEffect(() => {
    if (!showPresets || presets.length > 0) return;
    templatesApi
      .rewardPresets()
      .then((res) => setPresets((res.data as { presets: RewardPreset[] }).presets))
      .catch(() => undefined);
  }, [showPresets, presets.length]);

  /** Fill the form from a preset. Nothing is saved until the parent submits. */
  const applyPreset = (preset: RewardPreset) => {
    setFormData((prev) => ({
      ...prev,
      name: preset.name,
      description: preset.description,
      pointsCost: String(preset.pointsCost),
      tier: preset.tier,
    }));
    setShowPresets(false);
  };
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    pointsCost: '',
    tier: 'small' as 'small' | 'medium' | 'large',
    // M6 - CR-11: cap fields
    maxRedemptionsPerChild: '',
    maxRedemptionsTotal: '',
    expiresAt: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const pointsCost = parseInt(formData.pointsCost);
      if (isNaN(pointsCost) || pointsCost < 1) {
        showError('Points cost must be at least 1');
        setIsLoading(false);
        return;
      }

      // Parse optional cap fields - only send if the parent filled them in
      const maxRedemptionsPerChild = formData.maxRedemptionsPerChild
        ? parseInt(formData.maxRedemptionsPerChild)
        : undefined;
      const maxRedemptionsTotal = formData.maxRedemptionsTotal
        ? parseInt(formData.maxRedemptionsTotal)
        : undefined;

      // Validate caps if provided
      if (maxRedemptionsPerChild !== undefined && (isNaN(maxRedemptionsPerChild) || maxRedemptionsPerChild < 1)) {
        showError('Per-child limit must be at least 1');
        setIsLoading(false);
        return;
      }
      if (maxRedemptionsTotal !== undefined && (isNaN(maxRedemptionsTotal) || maxRedemptionsTotal < 1)) {
        showError('Household limit must be at least 1');
        setIsLoading(false);
        return;
      }

      if (formData.expiresAt && new Date(formData.expiresAt) <= new Date()) {
        showError('Expiry date must be in the future');
        setIsLoading(false);
        return;
      }

      await rewardsApi.create({
        name: formData.name,
        description: formData.description || undefined,
        pointsCost,
        tier: formData.tier,
        maxRedemptionsPerChild,
        maxRedemptionsTotal,
        expiresAt: formData.expiresAt ? new Date(formData.expiresAt).toISOString() : undefined,
      } as Parameters<typeof rewardsApi.create>[0]);

      showSuccess('Reward created!');
      router.push('/parent/rewards');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create reward';
      showError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ParentLayout>
      <div className="max-w-xl mx-auto space-y-6">
        <Link
          href="/parent/rewards"
          className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Rewards</span>
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold text-slate-900">Create Reward</h1>
            <p className="text-slate-600 mt-1">Add a new reward for your children to earn</p>
          </div>
          {/* Growth roadmap §3.1: "I don't know what to offer" is the reward-side cold start.
              Picking a preset fills the form; the parent edits before submitting. */}
          <button
            type="button"
            onClick={() => setShowPresets((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gold-200 bg-gold-50 text-gold-700 text-sm font-medium px-3 py-2 hover:bg-gold-100 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {showPresets ? 'Hide ideas' : 'Need ideas?'}
          </button>
        </div>

        {showPresets && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-sm text-slate-500 mb-3">
              Pick one to fill the form — you can change anything before saving.
            </p>
            {presets.length === 0 ? (
              <p className="text-sm text-slate-400">Loading ideas…</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className="text-left rounded-xl border border-slate-200 p-3 hover:border-gold-400 hover:bg-gold-50/50 transition-colors"
                  >
                    <p className="font-medium text-slate-900 text-sm">{preset.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{preset.description}</p>
                    <p className="text-xs text-gold-600 font-medium mt-1">{preset.pointsCost} pts</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* ── Basic Info ───────────────────────────────────────── */}
          <div className="bg-white rounded-xl p-6 border border-slate-200 space-y-4">
            <h2 className="font-semibold text-slate-900">Basic Info</h2>

            <Input
              label="Reward Name"
              placeholder="e.g., Extra Screen Time, Ice Cream Trip"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Description <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <textarea
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                rows={3}
                placeholder="Describe the reward..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <Input
              label="Points Cost"
              type="number"
              min={1}
              max={100000}
              placeholder="e.g., 100"
              value={formData.pointsCost}
              onChange={(e) => setFormData({ ...formData, pointsCost: e.target.value })}
              required
            />

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Tier</label>
              <div className="grid grid-cols-3 gap-2">
                {TIER_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, tier: opt.value })}
                    className={[
                      'flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-sm font-medium transition-all',
                      formData.tier === opt.value
                        ? 'border-primary-500 bg-primary-50 text-primary-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300',
                    ].join(' ')}
                  >
                    <span className="text-lg">{opt.label.split(' ')[0]}</span>
                    <span>{opt.label.split(' ')[1]}</span>
                    <span className="text-xs text-slate-400 font-normal text-center leading-tight">
                      {opt.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── M6: Cap Rules ────────────────────────────────────── */}
          <div className="bg-white rounded-xl p-6 border border-slate-200 space-y-4">
            <div>
              <h2 className="font-semibold text-slate-900">Claim Limits</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Optionally restrict how many times this reward can be claimed. Leave blank for unlimited.
              </p>
            </div>

            {/* Per-child cap */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                Per-child limit
              </label>
              <Input
                type="number"
                min={1}
                placeholder="e.g., 1 (each child can claim once)"
                value={formData.maxRedemptionsPerChild}
                onChange={(e) => setFormData({ ...formData, maxRedemptionsPerChild: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Max times one child can redeem this reward
              </p>
            </div>

            {/* Household total cap */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-400" />
                Household total limit
              </label>
              <Input
                type="number"
                min={1}
                placeholder="e.g., 3 (max 3 claims across all children)"
                value={formData.maxRedemptionsTotal}
                onChange={(e) => setFormData({ ...formData, maxRedemptionsTotal: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Max total claims across all children combined
              </p>
            </div>

            {/* Expiry date */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                Expiry date <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                value={formData.expiresAt}
                min={new Date().toISOString().slice(0, 16)}
                onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Reward locks automatically after this date/time
              </p>
            </div>
          </div>

          {/* ── Actions ──────────────────────────────────────────── */}
          <div className="flex gap-3">
            <Link href="/parent/rewards" className="flex-1">
              <Button type="button" variant="secondary" fullWidth>
                Cancel
              </Button>
            </Link>
            <Button type="submit" fullWidth loading={isLoading}>
              Create Reward
            </Button>
          </div>
        </form>
      </div>
    </ParentLayout>
  );
}