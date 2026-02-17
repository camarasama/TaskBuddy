'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Gift,
  Star,
  Check,
  Clock,
  Sparkles,
  ShoppingCart,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChildLayout } from '@/components/layouts/ChildLayout';
import { rewardsApi, dashboardApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn, formatPoints } from '@/lib/utils';
import Confetti from 'react-confetti';

interface Reward {
  id: string;
  name: string;
  description?: string;
  pointsCost: number;
  iconUrl?: string;
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
    } catch {
      showError('Failed to redeem reward');
    } finally {
      setRedeemingId(null);
    }
  };

  const pendingRedemptions = redemptions.filter(r => r.status === 'pending');

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
        {/* Header with Points */}
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

        {/* Pending Rewards */}
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
                    <p className="text-sm text-warning-600">
                      Ask your parent to give this to you!
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Available Rewards */}
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

        {/* Recent Redemptions */}
        {redemptions.filter(r => r.status === 'fulfilled').length > 0 && (
          <section>
            <h2 className="font-display font-bold text-lg text-slate-900 mb-4 flex items-center gap-2">
              <Check className="w-5 h-5 text-success-500" />
              Recent Rewards
            </h2>
            <div className="space-y-3">
              {redemptions
                .filter(r => r.status === 'fulfilled')
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

// Reward Card Component
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

  return (
    <motion.div
      whileTap={canAfford ? { scale: 0.98 } : undefined}
      className={cn(
        'bg-white rounded-xl p-4 border transition-all',
        canAfford
          ? 'border-xp-200 hover:border-xp-400 hover:shadow-md'
          : 'border-slate-200 opacity-75'
      )}
    >
      {/* Icon */}
      <div className="w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-br from-xp-400 to-xp-600 flex items-center justify-center">
        <Gift className="w-7 h-7 text-white" />
      </div>

      {/* Name */}
      <h3 className="font-bold text-slate-900 text-center mb-1 line-clamp-1">
        {reward.name}
      </h3>

      {/* Points */}
      <div className="flex items-center justify-center gap-1 text-gold-600 font-bold mb-3">
        <Star className="w-4 h-4" />
        <span>{formatPoints(reward.pointsCost)}</span>
      </div>

      {/* Progress (if can't afford) */}
      {!canAfford && (
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

      {/* Redeem Button */}
      <Button
        fullWidth
        variant={canAfford ? 'gold' : 'secondary'}
        size="sm"
        onClick={onRedeem}
        disabled={!canAfford || isRedeeming}
        loading={isRedeeming}
      >
        {canAfford ? (
          <>
            <Sparkles className="w-4 h-4" />
            Get it!
          </>
        ) : (
          'Save up!'
        )}
      </Button>
    </motion.div>
  );
}
