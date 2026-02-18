'use client';

/**
 * Parent Rewards Page — updated M6 (CR-11)
 *
 * Changes from M6:
 *  - Reward interface updated: added maxRedemptionsTotal and computed cap fields
 *    (totalRedemptionsUsed, remainingTotal, remainingForChild, isExpired, isSoldOut)
 *  - RewardCard now shows:
 *    · "Sold Out" pill when isSoldOut is true
 *    · "Expired" pill when isExpired is true
 *    · Expiry countdown badge when expiresAt is set and in the future
 *    · Redemption usage badge (e.g. "2 / 5 claimed")
 *  - Removed stale maxRedemptionsPerWeek field (was never in the schema)
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus,
  Gift,
  Star,
  Check,
  Clock,
  Edit2,
  Trash2,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { rewardsApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, formatPoints, formatDate } from '@/lib/utils';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Reward {
  id: string;
  name: string;
  description?: string;
  pointsCost: number;
  iconUrl?: string;
  isActive: boolean;
  tier?: string;
  // Cap config
  maxRedemptionsPerChild?: number | null;
  maxRedemptionsTotal?: number | null;
  expiresAt?: string | null;
  // Computed cap fields returned by GET /rewards (M6)
  totalRedemptionsUsed: number;
  remainingTotal: number | null;
  isExpired: boolean;
  isSoldOut: boolean;
  createdAt: string;
}

interface Redemption {
  id: string;
  status: string;
  createdAt: string;
  fulfilledAt?: string;
  reward: {
    name: string;
    pointsCost: number;
  };
  child: {
    id: string;
    firstName: string;
    lastName: string;
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ParentRewardsPage() {
  const { error: showError, success: showSuccess } = useToast();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'rewards' | 'redemptions'>('rewards');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [rewardsRes, redemptionsRes] = await Promise.all([
        rewardsApi.getAll(),
        rewardsApi.getRedemptionHistory(),
      ]);
      setRewards((rewardsRes.data as { rewards: Reward[] }).rewards);
      setRedemptions((redemptionsRes.data as { redemptions: Redemption[] }).redemptions);
    } catch {
      showError('Failed to load rewards');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this reward?')) return;
    try {
      await rewardsApi.delete(id);
      showSuccess('Reward deleted');
      loadData();
    } catch {
      showError('Failed to delete reward');
    }
  };

  const handleFulfill = async (id: string) => {
    try {
      await rewardsApi.fulfillRedemption(id);
      showSuccess('Reward fulfilled!');
      loadData();
    } catch {
      showError('Failed to fulfill reward');
    }
  };

  const pendingRedemptions = redemptions.filter((r) => r.status === 'pending');

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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-slate-900">Rewards</h1>
            <p className="text-slate-600 mt-1">Manage rewards for your children</p>
          </div>
          <Link href="/parent/rewards/new">
            <Button>
              <Plus className="w-4 h-4" />
              Create Reward
            </Button>
          </Link>
        </div>

        {/* Pending redemption alert */}
        {pendingRedemptions.length > 0 && (
          <div className="bg-warning-50 border border-warning-200 rounded-xl p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-warning-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-warning-600" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-warning-800">
                {pendingRedemptions.length} reward{pendingRedemptions.length > 1 ? 's' : ''} waiting to be fulfilled
              </p>
              <p className="text-sm text-warning-600">Review and fulfill redeemed rewards</p>
            </div>
            <Button variant="warning" size="sm" onClick={() => setActiveTab('redemptions')}>
              Review
            </Button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 border-b border-slate-200">
          <button
            onClick={() => setActiveTab('rewards')}
            className={cn(
              'px-4 py-3 font-medium text-sm border-b-2 transition-colors',
              activeTab === 'rewards'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            Available Rewards ({rewards.length})
          </button>
          <button
            onClick={() => setActiveTab('redemptions')}
            className={cn(
              'px-4 py-3 font-medium text-sm border-b-2 transition-colors',
              activeTab === 'redemptions'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            Redemption History
            {pendingRedemptions.length > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-warning-100 text-warning-700">
                {pendingRedemptions.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        {activeTab === 'rewards' ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rewards.length === 0 ? (
              <div className="col-span-full text-center py-12 bg-white rounded-xl border-2 border-dashed border-slate-200">
                <Gift className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="font-bold text-slate-900 mb-2">No rewards yet</h3>
                <p className="text-slate-600 mb-4">Create rewards for your children to redeem</p>
                <Link href="/parent/rewards/new">
                  <Button>
                    <Plus className="w-4 h-4" />
                    Create Reward
                  </Button>
                </Link>
              </div>
            ) : (
              rewards.map((reward) => (
                <RewardCard key={reward.id} reward={reward} onDelete={() => handleDelete(reward.id)} />
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {redemptions.length === 0 ? (
              <div className="text-center py-12">
                <Gift className="w-12 h-12 text-slate-400 mx-auto mb-4" />
                <h3 className="font-bold text-slate-900 mb-2">No redemptions yet</h3>
                <p className="text-slate-600">Redemptions will appear here when children redeem rewards</p>
              </div>
            ) : (
              redemptions.map((redemption) => (
                <RedemptionCard
                  key={redemption.id}
                  redemption={redemption}
                  onFulfill={() => handleFulfill(redemption.id)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </ParentLayout>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * getExpiryLabel
 * Returns a human-readable string for how much time is left before expiry.
 * e.g. "Expires in 2d 4h", "Expires in 30m", "Expired"
 */
function getExpiryLabel(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `Expires in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Expires in ${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `Expires in ${days}d ${remHours}h` : `Expires in ${days}d`;
}

// ─── RewardCard ───────────────────────────────────────────────────────────────

function RewardCard({ reward, onDelete }: { reward: Reward; onDelete: () => void }) {
  const isUnavailable = !reward.isActive || reward.isExpired || reward.isSoldOut;

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className={cn(
        'bg-white rounded-xl p-5 border transition-all',
        isUnavailable ? 'border-slate-200 opacity-60' : 'border-slate-200'
      )}
    >
      {/* Icon + actions row */}
      <div className="flex items-start justify-between mb-4">
        <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center">
          <Gift className="w-7 h-7 text-white" />
        </div>
        <div className="flex gap-2">
          <Link href={`/parent/rewards/${reward.id}/edit`}>
            <Button variant="ghost" size="icon-sm">
              <Edit2 className="w-4 h-4" />
            </Button>
          </Link>
          <Button variant="ghost" size="icon-sm" onClick={onDelete}>
            <Trash2 className="w-4 h-4 text-red-500" />
          </Button>
        </div>
      </div>

      {/* Name & description */}
      <h3 className="font-bold text-slate-900 mb-1">{reward.name}</h3>
      {reward.description && (
        <p className="text-sm text-slate-600 mb-3 line-clamp-2">{reward.description}</p>
      )}

      {/* Status badges row */}
      <div className="flex flex-wrap gap-2 mb-3">
        {/* M6: Sold Out badge */}
        {reward.isSoldOut && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <Users className="w-3 h-3" />
            Sold Out
          </span>
        )}

        {/* M6: Expired badge */}
        {reward.isExpired && !reward.isSoldOut && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            <AlertTriangle className="w-3 h-3" />
            Expired
          </span>
        )}

        {/* M6: Expiry countdown badge (only when not yet expired) */}
        {reward.expiresAt && !reward.isExpired && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            <Clock className="w-3 h-3" />
            {getExpiryLabel(reward.expiresAt)}
          </span>
        )}

        {/* M6: Redemption usage (e.g. "3 / 5 claimed") */}
        {reward.maxRedemptionsTotal !== null && reward.maxRedemptionsTotal !== undefined && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
            {reward.totalRedemptionsUsed} / {reward.maxRedemptionsTotal} claimed
          </span>
        )}

        {/* Inactive badge */}
        {!reward.isActive && !reward.isSoldOut && !reward.isExpired && (
          <span className="badge bg-slate-100 text-slate-600">Inactive</span>
        )}
      </div>

      {/* Points cost */}
      <div className="flex items-center gap-1 text-gold-600 font-bold">
        <Star className="w-4 h-4" />
        <span>{formatPoints(reward.pointsCost)} pts</span>
      </div>
    </motion.div>
  );
}

// ─── RedemptionCard ───────────────────────────────────────────────────────────

function RedemptionCard({
  redemption,
  onFulfill,
}: {
  redemption: Redemption;
  onFulfill: () => void;
}) {
  const isPending = redemption.status === 'pending';

  return (
    <div
      className={cn(
        'bg-white rounded-xl p-5 border',
        isPending ? 'border-warning-200' : 'border-slate-200'
      )}
    >
      <div className="flex items-center gap-4">
        <div
          className={cn(
            'w-12 h-12 rounded-full flex items-center justify-center',
            isPending
              ? 'bg-warning-100'
              : redemption.status === 'fulfilled'
              ? 'bg-success-100'
              : 'bg-slate-100'
          )}
        >
          {redemption.status === 'fulfilled' ? (
            <Check className="w-6 h-6 text-success-600" />
          ) : isPending ? (
            <Clock className="w-6 h-6 text-warning-600" />
          ) : (
            <Gift className="w-6 h-6 text-slate-600" />
          )}
        </div>

        <div className="flex-1">
          <p className="font-bold text-slate-900">
            {redemption.child?.firstName || 'Child'} redeemed {redemption.reward.name}
          </p>
          <p className="text-sm text-slate-500">
            {formatDate(redemption.createdAt)} — {formatPoints(redemption.reward.pointsCost)} pts
          </p>
        </div>

        {isPending ? (
          <Button variant="success" size="sm" onClick={onFulfill}>
            <Check className="w-4 h-4" />
            Fulfill
          </Button>
        ) : (
          <span
            className={cn(
              'badge',
              redemption.status === 'fulfilled'
                ? 'bg-success-100 text-success-700'
                : 'bg-slate-100 text-slate-600'
            )}
          >
            {redemption.status}
          </span>
        )}
      </div>
    </div>
  );
}