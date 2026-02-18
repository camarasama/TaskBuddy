'use client';

/**
 * Child Rewards Page — updated M6 (CR-11)
 *
 * Changes from M6:
 *  - Reward interface updated: added cap fields (maxRedemptionsTotal, expiresAt,
 *    totalRedemptionsUsed, remainingForChild, isExpired, isSoldOut)
 *  - RewardCard now:
 *    · Greys out and shows "Expired" label when isExpired is true
 *    · Greys out and shows "Sold Out" label when isSoldOut is true
 *    · Shows an expiry countdown badge when expiresAt is set and in the future
 *    · Shows remaining claims when remainingForChild is set
 *    · Disables the redeem button with the correct reason for cap violations
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gift,
  Star,
  Check,
  Clock,
  Sparkles,
  ShoppingCart,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { rewardsApi, dashboardApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, formatPoints } from '@/lib/utils';
import Confetti from 'react-confetti';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Reward {
  id: string;
  name: string;
  description?: string;
  pointsCost: number;
  iconUrl?: string;
  // Cap config
  maxRedemptionsPerChild?: number | null;
  maxRedemptionsTotal?: number | null;
  expiresAt?: string | null;
  // Computed cap fields (M6) — returned by GET /rewards for child callers
  remainingForChild: number | null;
  isExpired: boolean;
  isSoldOut: boolean;
}

interface Redemption {
  id: string;
  status: string;
  redeemedAt: string;
  reward: {
    name: string;
    pointsCost: number;
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChildRewardsPage() {
  const { error: showError, success: showSuccess } = useToast();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [userPoints, setUserPoints] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [rewardsRes, redemptionsRes, dashboardRes] = await Promise.all([
        rewardsApi.getAll(),
        rewardsApi.getRedemptionHistory(),
        dashboardApi.getChildDashboard(),
      ]);
      setRewards((rewardsRes.data as { rewards: Reward[] }).rewards);
      setRedemptions((redemptionsRes.data as { redemptions: Redemption[] }).redemptions);
      const profile = (dashboardRes.data as { profile: { pointsBalance: number } }).profile;
      setUserPoints(profile?.pointsBalance || 0);
    } catch {
      showError('Failed to load rewards');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRedeem = async (reward: Reward) => {
    if (userPoints < reward.pointsCost) {
      showError('Not enough points!');
      return;
    }

    setRedeemingId(reward.id);
    try {
      await rewardsApi.redeem(reward.id);
      showSuccess(`Yay! You redeemed ${reward.name}!`);
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
      loadData();
    } catch (err: any) {
      // Show the specific cap error message from the API if available
      const msg = err?.response?.data?.message || 'Failed to redeem reward';
      showError(msg);
    } finally {
      setRedeemingId(null);
    }
  };

  const pendingRedemptions = redemptions.filter((r) => r.status === 'pending');

  if (isLoading) {
    return (
      <ChildLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-xp-500 border-t-transparent" />
        </div>
      </ChildLayout>
    );
  }

  return (
    <ChildLayout>
      {showConfetti && (
        <Confetti
          width={window.innerWidth}
          height={window.innerHeight}
          recycle={false}
          numberOfPieces={300}
          colors={['#fbbf24', '#f59e0b', '#eab308', '#a855f7', '#22c55e']}
        />
      )}

      <div className="space-y-6">
        {/* Points balance header */}
        <div className="bg-gradient-to-r from-gold-400 to-gold-600 rounded-2xl p-6 text-white shadow-lg shadow-gold-500/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gold-100">Your Points</p>
              <div className="flex items-center gap-2">
                <Star className="w-8 h-8" />
                <span className="text-4xl font-bold">{formatPoints(userPoints)}</span>
              </div>
            </div>
            <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
              <ShoppingCart className="w-8 h-8" />
            </div>
          </div>
        </div>

        {/* Pending rewards section */}
        {pendingRedemptions.length > 0 && (
          <section>
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-warning-500" />
              Waiting for Parents
            </h2>
            <div className="space-y-3">
              {pendingRedemptions.map((redemption) => (
                <div
                  key={redemption.id}
                  className="bg-warning-50 rounded-xl p-4 border border-warning-200 flex items-center gap-4"
                >
                  <div className="w-12 h-12 rounded-full bg-warning-100 flex items-center justify-center">
                    <Clock className="w-6 h-6 text-warning-600" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-slate-900">{redemption.reward.name}</p>
                    <p className="text-sm text-warning-600">Ask your parent to give this to you!</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Rewards shop */}
        <section>
          <h2 className="font-display font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
            <Gift className="w-5 h-5 text-xp-500" />
            Rewards Shop
          </h2>

          {rewards.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
              <Gift className="w-12 h-12 text-slate-400 mx-auto mb-4" />
              <h3 className="font-bold text-slate-900 mb-2">No rewards available</h3>
              <p className="text-slate-600">Ask your parents to add some rewards!</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <AnimatePresence>
                {rewards.map((reward, index) => (
                  <motion.div
                    key={reward.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <RewardCard
                      reward={reward}
                      userPoints={userPoints}
                      onRedeem={() => handleRedeem(reward)}
                      isRedeeming={redeemingId === reward.id}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* Past fulfilled rewards */}
        {redemptions.filter((r) => r.status === 'fulfilled').length > 0 && (
          <section>
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
              <Check className="w-5 h-5 text-success-500" />
              Recent Rewards
            </h2>
            <div className="space-y-3">
              {redemptions
                .filter((r) => r.status === 'fulfilled')
                .slice(0, 5)
                .map((redemption) => (
                  <div
                    key={redemption.id}
                    className="bg-success-50 rounded-xl p-4 border border-success-200 flex items-center gap-4"
                  >
                    <div className="w-10 h-10 rounded-full bg-success-500 flex items-center justify-center">
                      <Check className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-success-800">{redemption.reward.name}</p>
                    </div>
                    <span className="text-sm text-success-600">Received!</span>
                  </div>
                ))}
            </div>
          </section>
        )}
      </div>
    </ChildLayout>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * getExpiryLabel — same helper used on the parent page
 * Returns "Expires in Xd Yh", "Expires in Zm", or "Expired"
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

function RewardCard({
  reward,
  userPoints,
  onRedeem,
  isRedeeming,
}: {
  reward: Reward;
  userPoints: number;
  onRedeem: () => void;
  isRedeeming: boolean;
}) {
  const canAfford = userPoints >= reward.pointsCost;
  const progress = Math.min((userPoints / reward.pointsCost) * 100, 100);

  // M6: determine if the reward is unavailable due to cap rules
  const isUnavailable = reward.isExpired || reward.isSoldOut;
  const isRedeemable = canAfford && !isUnavailable;

  // Determine button label and disabled reason
  let buttonLabel: React.ReactNode = 'Save up!';
  if (reward.isExpired) buttonLabel = 'Expired';
  else if (reward.isSoldOut) buttonLabel = 'Sold Out';
  else if (isRedeemable) buttonLabel = <><Sparkles className="w-4 h-4" /> Get it!</>;

  return (
    <motion.div
      whileTap={isRedeemable ? { scale: 0.98 } : undefined}
      className={cn(
        'bg-white rounded-xl p-4 border transition-all',
        isRedeemable
          ? 'border-xp-200 hover:border-xp-400 hover:shadow-md'
          : 'border-slate-200 opacity-70'
      )}
    >
      {/* Icon */}
      <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center">
        <Gift className="w-7 h-7 text-white" />
      </div>

      {/* Name */}
      <h3 className="font-bold text-slate-900 text-center mb-1 line-clamp-1">{reward.name}</h3>

      {/* Points cost */}
      <div className="flex items-center justify-center gap-1 text-gold-600 font-bold mb-2">
        <Star className="w-4 h-4" />
        <span>{formatPoints(reward.pointsCost)}</span>
      </div>

      {/* M6: Status badges */}
      <div className="flex flex-wrap justify-center gap-1 mb-3">
        {reward.isSoldOut && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
            <Users className="w-3 h-3" />
            Sold Out
          </span>
        )}
        {reward.isExpired && !reward.isSoldOut && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
            <AlertTriangle className="w-3 h-3" />
            Expired
          </span>
        )}
        {reward.expiresAt && !reward.isExpired && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            <Clock className="w-3 h-3" />
            {getExpiryLabel(reward.expiresAt)}
          </span>
        )}
        {/* Remaining personal claims */}
        {reward.remainingForChild !== null && reward.remainingForChild <= 2 && !isUnavailable && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            {reward.remainingForChild === 0
              ? 'Max claimed'
              : `${reward.remainingForChild} left for you`}
          </span>
        )}
      </div>

      {/* Save-up progress bar (only when unaffordable and not blocked by caps) */}
      {!canAfford && !isUnavailable && (
        <div className="mb-3">
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              className="h-full bg-gradient-to-r from-gold-400 to-gold-600 rounded-full"
            />
          </div>
          <p className="text-xs text-center text-slate-500 mt-1">
            {formatPoints(reward.pointsCost - userPoints)} more needed
          </p>
        </div>
      )}

      {/* Redeem button */}
      <Button
        fullWidth
        variant={isRedeemable ? 'gold' : 'secondary'}
        size="sm"
        onClick={onRedeem}
        disabled={!isRedeemable || isRedeeming}
        loading={isRedeeming}
      >
        {buttonLabel}
      </Button>
    </motion.div>
  );
}