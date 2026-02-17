'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ParentLayout } from '@/components/layouts/ParentLayout';
import { rewardsApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

export default function NewRewardPage() {
  const router = useRouter();
  const { error: showError, success: showSuccess } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    pointsCost: '',
    tier: 'small' as 'small' | 'medium' | 'large',
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

      await rewardsApi.create({
        name: formData.name,
        description: formData.description || undefined,
        pointsCost,
        tier: formData.tier,
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

        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Create Reward</h1>
          <p className="text-slate-600 mt-1">Add a new reward for your children to earn</p>
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
              onChange={(e) => setFormData({ ...formData, tier: e.target.value as 'small' | 'medium' | 'large' })}
            >
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
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
