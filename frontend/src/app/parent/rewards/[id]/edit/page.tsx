'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { rewardsApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

interface Reward {
  id: string;
  name: string;
  description?: string;
  pointsCost: number;
  tier?: string;
  isActive: boolean;
}

export default function EditRewardPage() {
  const params = useParams();
  const router = useRouter();
  const { error: showError, success: showSuccess } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    pointsCost: '',
    tier: 'small',
    isActive: true,
  });

  const rewardId = params.id as string;

  useEffect(() => {
    const loadReward = async () => {
      try {
        const response = await rewardsApi.getById(rewardId);
        const reward = (response.data as { reward: Reward }).reward;
        if (reward) {
          setFormData({
            name: reward.name,
            description: reward.description || '',
            pointsCost: String(reward.pointsCost),
            tier: reward.tier || 'small',
            isActive: reward.isActive,
          });
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

      await rewardsApi.update(rewardId, {
        name: formData.name,
        description: formData.description || undefined,
        pointsCost,
        tier: formData.tier as 'small' | 'medium' | 'large',
        isActive: formData.isActive,
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

        <form onSubmit={handleSubmit} className="bg-white rounded-xl p-6 border border-slate-200 space-y-4">
          <Input
            label="Reward Name"
            placeholder="e.g., Extra Screen Time, Ice Cream Trip"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Description (optional)
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
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Tier</label>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              value={formData.tier}
              onChange={(e) => setFormData({ ...formData, tier: e.target.value })}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>

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

          <div className="flex gap-3 pt-4">
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
