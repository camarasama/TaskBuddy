/**
 * app/unsubscribe/page.tsx - "Stop tips and reminders" landing page (2026-10-26).
 *
 * Linked from every re-engagement email. Public: the link carries a signed token, not a session.
 * Deliberately needs a click. Mail scanners and link previews open every URL in an email, so
 * unsubscribing on page load would opt people out who never asked.
 */

'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { adminInsightsApi } from '@/lib/adminInsightsApi';

function UnsubscribeInner() {
  const params = useSearchParams();
  const u = params.get('u') ?? '';
  const t = params.get('t') ?? '';
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>(u && t ? 'idle' : 'error');

  async function confirm() {
    setStatus('busy');
    try {
      await adminInsightsApi.unsubscribe(u, t);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200 max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          <BrandLogo variant="mark" size={40} alt="TaskBuddy" />
        </div>
        {status === 'done' && (
          <>
            <CheckCircle2 className="w-12 h-12 text-success-500 mx-auto mb-4" aria-hidden="true" />
            <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">You are unsubscribed</h1>
            <p className="text-slate-600">
              We will not send you tips and reminders again. Emails about your family&apos;s tasks, rewards and
              account still arrive as before.
            </p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" aria-hidden="true" />
            <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">This link is not valid</h1>
            <p className="text-slate-600">
              Please use the link from the most recent email, or change your email settings in the app.
            </p>
          </>
        )}
        {(status === 'idle' || status === 'busy') && (
          <>
            <h1 className="font-display text-2xl font-bold text-slate-900 mb-2">Stop tips and reminders?</h1>
            <p className="text-slate-600 mb-6">
              These are the occasional emails we send when your family has not used TaskBuddy for a while.
            </p>
            <Button onClick={confirm} loading={status === 'busy'} fullWidth>
              Yes, stop these emails
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={null}>
      <UnsubscribeInner />
    </Suspense>
  );
}
