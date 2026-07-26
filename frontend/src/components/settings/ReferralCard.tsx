'use client';

/**
 * ReferralCard — the cross-family referral loop (growth roadmap §7).
 *
 * §7 is the only section of the roadmap with nothing built behind it, and this is the parent-facing
 * half of the one row in it that is code rather than marketing work.
 *
 * The reward is a badge and nothing else. There is deliberately no points offer here, and the copy
 * does not imply one: anything with in-app value would create a reason to game this, and children
 * are the only people in the product who could be gamed by it.
 *
 * It shows how many families joined, never who. That is their business, not this family's.
 */

import { useCallback, useEffect, useState } from 'react';
import { Gift, Copy, Check, Loader2 } from 'lucide-react';
import { familyApi } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

interface ReferralSummary {
  referralCode: string;
  shareUrl: string;
  referredCount: number;
  badge: string | null;
  nextBadgeAt: number | null;
}

export function ReferralCard() {
  const { success: showSuccess, error: showError } = useToast();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await familyApi.getReferral();
      setSummary(res.data as ReferralSummary);
    } catch {
      // Non-fatal — the section simply does not render.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.shareUrl);
      setCopied(true);
      showSuccess('Link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showError('Could not copy — select the link and copy it manually');
    }
  };

  if (loading) {
    return (
      <section className="bg-white rounded-xl p-6 border border-slate-200 flex justify-center">
        <Loader2 className="w-5 h-5 text-slate-300 animate-spin" />
      </section>
    );
  }
  if (!summary) return null;

  return (
    <section className="bg-white rounded-xl p-6 border border-slate-200">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-gold-100 flex items-center justify-center">
          <Gift className="w-5 h-5 text-gold-600" />
        </div>
        <h2 className="font-display font-bold text-lg text-slate-900">Invite another family</h2>
      </div>

      <p className="text-sm text-slate-600 mb-4">
        Share your link with a family who might find TaskBuddy useful. They get their own separate
        account — your tasks, children and points stay private.
      </p>

      <div className="flex items-center gap-2 mb-4">
        <code className="flex-1 min-w-0 truncate rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-sm text-slate-700">
          {summary.shareUrl}
        </code>
        <button
          onClick={copy}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 text-white text-sm px-3 py-2 hover:bg-slate-800"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100">
        <div>
          <p className="text-2xl font-bold text-slate-900">{summary.referredCount}</p>
          <p className="text-xs text-slate-500">
            {summary.referredCount === 1 ? 'family joined' : 'families joined'}
          </p>
        </div>

        {summary.badge ? (
          <span className="inline-flex items-center rounded-full bg-gold-50 border border-gold-200 text-gold-700 px-3 py-1 text-sm font-medium">
            🏅 {summary.badge}
          </span>
        ) : summary.nextBadgeAt ? (
          <p className="text-xs text-slate-400 text-right">
            {summary.nextBadgeAt} {summary.nextBadgeAt === 1 ? 'family' : 'families'} for your first
            badge
          </p>
        ) : null}
      </div>
    </section>
  );
}
