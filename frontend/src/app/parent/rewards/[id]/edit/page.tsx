'use client';

/**
 * Edit Reward Page — updated M6 (CR-11)
 *
 * Added fields (pre-populated from existing reward data):
 *  - maxRedemptionsPerChild: per-child claim limit
 *  - maxRedemptionsTotal: household-level claim cap
 *  - expiresAt: reward expiry date/time
 *
 * Also shows a read-only "Cap Status" block so the parent can see
 * how many claims have already been used before editing the caps.
 */

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Users, User, Calendar, Info } from 'lucide-react';
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

interface RewardDetail {
  id: string;
  name: string;
  description?: string;
  pointsCost: number;
  tier?: string;
  isActive: boolean;
  maxRedemptionsPerChild?: number | null;
  maxRedemptionsTotal?: number | null;
  expiresAt?: string | null;
  // Computed cap data from M6
  totalRedemptionsUsed?: number;
  isExpired?: boolean;
  isSoldOut?: boolean;
}

export default function EditRewardPage() {
  const params = useParams();
  const router = useRouter();
  const { error: showError, success: showSuccess } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [capStatus, setCapStatus] = useState<{
    totalRedemptionsUsed: number;
    isExpired: boolean;
    isSoldOut: boolean;
  } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    pointsCost: '',
    tier: 'small',
    isActive: true,
    // M6 — CR-11: cap fields
    maxRedemptionsPerChild: '',
    maxRedemptionsTotal: '',
    expiresAt: '',
  });

  const rewardId = params.id as string;

  useEffect(() => {
    const loadReward = async () => {
      try {
        const response = await rewardsApi.getById(rewardId);
        const reward = (response.data as { reward: RewardDetail }).reward;

        if (reward) {
          // Convert ISO expiresAt to datetime-local format (strip seconds + Z)
          const expiresAtLocal = reward.expiresAt
            ? new Date(reward.expiresAt).toISOString().slice(0, 16)
            : '';

          setFormData({
            name: reward.name,
            description: reward.description || '',
            pointsCost: String(reward.pointsCost),
            tier: reward.tier || 'small',
            isActive: reward.isActive,
            maxRedemptionsPerChild: reward.maxRedemptionsPerChild
              ? String(reward.maxRedemptionsPerChild)
              : '',
            maxRedemptionsTotal: reward.maxRedemptionsTotal
              ? String(reward.maxRedemptionsTotal)
              : '',
            expiresAt: expiresAtLocal,
          });

          // Store computed cap data to show in status block
          if (reward.totalRedemptionsUsed !== undefined) {
            setCapStatus({
              totalRedemptionsUsed: reward.totalRedemptionsUsed,
              isExpired: reward.isExpired ?? false,
              isSoldOut: reward.isSoldOut ?? false,
            });
          }
        }
      } catch {
        showError('Failed to load reward');
        router.push('/parent/rewards');
      } finally {
        setIsLoading(false);
      }
    };

    if (rewardId) {
      loadReward();
    }
  }, [rewardId, showError, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const pointsCost = parseInt(formData.pointsCost);
      if (isNaN(pointsCost) || pointsCost < 1) {
        showError('Points cost must be at least 1');
        setIsSaving(false);
        return;
      }

      const maxRedemptionsPerChild = formData.maxRedemptionsPerChild
        ? parseInt(formData.maxRedemptionsPerChild)
        : null;
      const maxRedemptionsTotal = formData.maxRedemptionsTotal
        ? parseInt(formData.maxRedemptionsTotal)
        : null;

      if (maxRedemptionsPerChild !== null && (isNaN(maxRedemptionsPerChild) || maxRedemptionsPerChild < 1)) {
        showError('Per-child limit must be at least 1');
        setIsSaving(false);
        return;
      }
      if (maxRedemptionsTotal !== null && (isNaN(maxRedemptionsTotal) || maxRedemptionsTotal < 1)) {
        showError('Household limit must be at least 1');
        setIsSaving(false);
        return;
      }

      await rewardsApi.update(rewardId, {
        name: formData.name,
        description: formData.description || undefined,
        pointsCost,
        tier: formData.tier as 'small' | 'medium' | 'large',
        isActive: formData.isActive,
        maxRedemptionsPerChild: maxRedemptionsPerChild ?? undefined,
        maxRedemptionsTotal: maxRedemptionsTotal ?? undefined,
        // Send null explicitly to clear expiry; send ISO string to set it
        expiresAt: formData.expiresAt
          ? new Date(formData.expiresAt).toISOString()
          : null,
      } as Parameters<typeof rewardsApi.update>[1]);

      showSuccess('Reward updated!');
      router.push('/parent/rewards');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update reward';
      showError(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <ParentLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
        </div>
      </ParentLayout>
    );
  }

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

        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Edit Reward</h1>
          <p className="text-slate-600 mt-1">Update reward details</p>
        </div>

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

            {/* Active toggle */}
            <label className="flex items-center justify-between p-4 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-50">
              <div>
                <p className="font-medium text-slate-900">Active</p>
                <p className="text-sm text-slate-500">Make this reward available for redemption</p>
              </div>
              <input
                type="checkbox"
                className="w-5 h-5 rounded text-primary-600"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              />
            </label>
          </div>

          {/* ── M6: Cap Rules ────────────────────────────────────── */}
          <div className="bg-white rounded-xl p-6 border border-slate-200 space-y-4">
            <div>
              <h2 className="font-semibold text-slate-900">Claim Limits</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Leave blank for unlimited. Clear a field to remove an existing limit.
              </p>
            </div>

            {/* M6: Current cap status (read-only info block) */}
            {capStatus && capStatus.totalRedemptionsUsed > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <Info className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div className="text-sm text-slate-600">
                  <span className="font-medium">{capStatus.totalRedemptionsUsed}</span> claim
                  {capStatus.totalRedemptionsUsed !== 1 ? 's' : ''} already used.
                  {capStatus.isSoldOut && ' This reward is currently sold out.'}
                  {capStatus.isExpired && ' This reward has expired.'}
                </div>
              </div>
            )}

            {/* Per-child cap */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                <span className="flex items-center gap-2">
                  <User className="w-4 h-4 text-slate-400" />
                  Per-child limit
                </span>
              </label>
              <Input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={formData.maxRedemptionsPerChild}
                onChange={(e) => setFormData({ ...formData, maxRedemptionsPerChild: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Max times one child can redeem this reward
              </p>
            </div>

            {/* Household total cap */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-400" />
                  Household total limit
                </span>
              </label>
              <Input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={formData.maxRedemptionsTotal}
                onChange={(e) => setFormData({ ...formData, maxRedemptionsTotal: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Max total claims across all children combined
              </p>
            </div>

            {/* Expiry */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                <span className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-400" />
                  Expiry date <span className="text-slate-400 font-normal">(optional)</span>
                </span>
              </label>
              <input
                type="datetime-local"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                value={formData.expiresAt}
                onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Clear this field to remove the expiry date
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
            <Button type="submit" fullWidth loading={isSaving}>
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </ParentLayout>
  );
}